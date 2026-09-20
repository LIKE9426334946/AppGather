import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { link, mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const USERNAME = 'noart';
const deriveKey = promisify(scrypt);
const SCRYPT_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };

export async function readCredentials(directory) {
  let data;
  try {
    data = JSON.parse(await readFile(join(directory, 'credentials.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('尚未设置登录密码，请先运行 bash deploy/setup-auth.sh');
    throw new Error('登录凭据文件无法读取，请检查 backend/data/credentials.json');
  }
  if (data?.version !== 1 || data.username !== USERNAME || !/^[a-f0-9]{32}$/.test(data.salt) ||
      !/^[a-f0-9]{128}$/.test(data.hash)) throw new Error('登录凭据文件格式不正确');
  return data;
}

export async function passwordMatches(password, credentials) {
  const candidate = await deriveKey(password, credentials.salt, 64, SCRYPT_OPTIONS);
  return timingSafeEqual(candidate, Buffer.from(credentials.hash, 'hex'));
}

export async function initializeCredentials(directory, password) {
  if (typeof password !== 'string' || !password || password.length > 1024) {
    throw new Error('密码不能为空且不能超过 1024 个字符');
  }
  const salt = randomBytes(16).toString('hex');
  const hash = (await deriveKey(password, salt, 64, SCRYPT_OPTIONS)).toString('hex');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, 'credentials.json');
  const temporary = filename + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify({ version: 1, username: USERNAME, salt, hash }, null, 2) + '\n');
      await file.sync();
    } finally {
      await file.close();
    }
    // A hard link publishes the complete file without overwriting existing credentials.
    await link(temporary, filename);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('登录密码已经设置，本次未覆盖');
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const directory = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), 'data');
    if (process.argv.includes('--check')) {
      await readCredentials(directory);
      console.log('noart 登录密码已设置。');
    } else {
      let password = '';
      for await (const chunk of process.stdin.setEncoding('utf8')) {
        password += chunk;
        if (password.length > 1024) throw new Error('密码不能超过 1024 个字符');
      }
      await initializeCredentials(directory, password);
      console.log('noart 登录密码已保存。');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
