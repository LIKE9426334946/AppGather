import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readCredentials, passwordMatches, USERNAME } from './credentials.js';

export { USERNAME };
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'appgather_session';
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

const fail = (status, message, retryAfter) => Object.assign(new Error(message), { status, retryAfter });
const digest = token => createHash('sha256').update(token).digest('hex');
const fromProxy = request => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
const secureRequest = request => Boolean(request.socket.encrypted) ||
  (fromProxy(request) && request.headers['x-forwarded-proto'] === 'https');

function readToken(request) {
  const value = request.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(COOKIE_NAME + '='))?.slice(COOKIE_NAME.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function cookie(request, token, expiresAt) {
  return [
    COOKIE_NAME + '=' + token, 'Path=/', 'HttpOnly', 'SameSite=Strict',
    'Max-Age=' + (token ? SESSION_MS / 1000 : 0),
    'Expires=' + new Date(expiresAt).toUTCString(),
    ...(secureRequest(request) ? ['Secure'] : []),
  ].join('; ');
}

// Options are an internal test seam; production credentials come only from the private data directory.
export async function createAuth(directory, {
  passwordSalt, passwordHash, now = Date.now,
} = {}) {
  const credentials = passwordSalt && passwordHash
    ? { salt: passwordSalt, hash: passwordHash }
    : await readCredentials(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, 'sessions.json');
  let sessions = new Map();
  try {
    const data = JSON.parse(await readFile(filename, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.sessions) || data.sessions.some(session =>
      !/^[a-f0-9]{64}$/.test(session?.tokenHash) || !Number.isSafeInteger(session?.expiresAt))) {
      throw new Error('登录会话文件格式不正确');
    }
    sessions = new Map(data.sessions.filter(session => session.expiresAt > now())
      .map(session => [session.tokenHash, session.expiresAt]));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let writeQueue = Promise.resolve();
  function changeSessions(change) {
    const operation = writeQueue.then(async () => {
      const updated = new Map([...sessions].filter(([, expiresAt]) => expiresAt > now()));
      change(updated);
      const temporary = filename + '.' + randomBytes(8).toString('hex') + '.tmp';
      try {
        const file = await open(temporary, 'wx', 0o600);
        try {
          await file.writeFile(JSON.stringify({
            version: 1,
            sessions: [...updated].map(([tokenHash, expiresAt]) => ({ tokenHash, expiresAt })),
          }, null, 2) + '\n');
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, filename);
        sessions = updated;
      } finally {
        await rm(temporary, { force: true });
      }
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  const failures = new Map();
  let checkingPassword = false;
  async function verify(request, input) {
    const timestamp = now();
    for (const [key, attempt] of failures) {
      if (attempt.until <= timestamp) failures.delete(key);
    }
    const address = (fromProxy(request) && request.headers['x-real-ip']) || request.socket.remoteAddress;
    const attempt = failures.get(address);
    if (attempt?.count >= 5) {
      throw fail(429, '尝试次数过多，请 15 分钟后重试', Math.ceil((attempt.until - timestamp) / 1000));
    }
    if (typeof input?.username !== 'string' || typeof input?.password !== 'string' ||
        input.username.length > 100 || !input.password || input.password.length > 1024) {
      throw fail(400, '请输入有效的用户名和密码');
    }
    // Bound memory use while running the memory-hard password check.
    if (checkingPassword) throw fail(429, '正在处理登录，请稍后重试', 1);
    checkingPassword = true;
    let matches;
    try {
      matches = await passwordMatches(input.password, credentials) && input.username === USERNAME;
    } finally {
      checkingPassword = false;
    }
    if (!matches) {
      if (!failures.has(address) && failures.size >= 1000) failures.delete(failures.keys().next().value);
      failures.set(address, { count: (attempt?.count || 0) + 1, until: attempt?.until || timestamp + ATTEMPT_WINDOW_MS });
      throw fail(401, '用户名或密码错误');
    }
    failures.delete(address);
  }

  return {
    session(request) {
      const token = readToken(request);
      const expiresAt = token && sessions.get(digest(token));
      return expiresAt > now() ? { username: USERNAME, expiresAt } : null;
    },
    async login(request, response, input) {
      await verify(request, input);
      const token = randomBytes(32).toString('base64url');
      const previous = readToken(request);
      const expiresAt = now() + SESSION_MS;
      await changeSessions(updated => {
        if (previous) updated.delete(digest(previous));
        updated.set(digest(token), expiresAt);
      });
      response.setHeader('Set-Cookie', cookie(request, token, expiresAt));
      return { username: USERNAME, expiresAt };
    },
    async logout(request, response) {
      const token = readToken(request);
      if (token && sessions.has(digest(token))) {
        await changeSessions(updated => updated.delete(digest(token)));
      }
      response.setHeader('Set-Cookie', cookie(request, '', 0));
    },
  };
}
