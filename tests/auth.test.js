import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SESSION_MS } from '../backend/auth.js';
import { createApp } from '../backend/server.js';
import { initializeCredentials, readCredentials } from '../backend/credentials.js';
import { start, post, TEST_PASSWORD } from './helpers.js';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'appgather-auth-'));
  let app = await start(directory, { ...options, authenticated: false });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return {
    directory,
    request: (...args) => app.request(...args),
    async restart() {
      await app.close();
      app = await start(directory, { ...options, authenticated: false });
    },
  };
}
const credentials = { username: 'noart', password: TEST_PASSWORD };
const withCookie = (cookie, options = {}) => ({ ...options, headers: { ...options.headers, Cookie: cookie } });
async function login(app, options = {}) {
  const response = await app.request('/api/auth/login', { ...post(credentials), ...options });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  return { setCookie, cookie: setCookie.split(';')[0], data: await response.json() };
}

test('服务器必须先初始化私有凭据，固定账号可用且初始化不会覆盖已有密码', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'appgather-credentials-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(createApp({ dataDir: directory }), /尚未设置登录密码/);
  await initializeCredentials(directory, TEST_PASSWORD);
  const original = await readCredentials(directory);
  assert.equal(original.username, 'noart');
  assert.equal((await stat(join(directory, 'credentials.json'))).mode & 0o777, 0o600);
  assert.equal((await readFile(join(directory, 'credentials.json'), 'utf8')).includes(TEST_PASSWORD), false);
  await assert.rejects(initializeCredentials(directory, 'another-test-password'), /已经设置/);
  assert.deepEqual(await readCredentials(directory), original);
  const server = await createApp({ dataDir: directory });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/auth/login', post(credentials));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).username, 'noart');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('未登录不能读取界面或任何数据接口，登录页和健康检查可访问', async t => {
  const app = await fixture(t);
  for (const path of ['/', '/index.html']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await app.request(path, { method });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/login');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(await response.text(), '');
    }
  }
  for (const [path, method] of [
    ['/app.js', 'GET'], ['/api/auth/session', 'GET'], ['/api/links', 'GET'],
    ['/api/links', 'POST'], ['/api/links/example', 'PATCH'], ['/api/links/example', 'DELETE'],
    ['/api/tags', 'POST'], ['/api/tags', 'PATCH'], ['/api/tags/default', 'PATCH'],
    ['/api/future-route', 'GET'],
  ]) assert.equal((await app.request(path, { method })).status, 401, path + ' ' + method);
  for (const path of ['/login', '/login.html', '/login.js', '/styles.css', '/favicon.svg']) {
    assert.equal((await app.request(path)).status, 200, path);
  }
  const html = await (await app.request('/login')).text();
  assert.match(html, /type="password"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.doesNotMatch(html, /注册|创建账号/);
  assert.deepEqual(await (await app.request('/api/health')).json(), { status: 'ok' });
});

test('只有固定账号可登录，Cookie 有效期为 30 天，服务器只保存令牌摘要', async t => {
  const app = await fixture(t);
  for (const input of [
    { ...credentials, username: 'another-user' },
    { ...credentials, password: 'incorrect-test-password' },
  ]) {
    const response = await app.request('/api/auth/login', post(input));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { error: '用户名或密码错误' });
  }
  const { cookie, setCookie, data } = await login(app);
  assert.match(setCookie, /appgather_session=[A-Za-z0-9_-]{43};/);
  assert.match(setCookie, /Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000;/);
  assert.doesNotMatch(setCookie, /Secure|Domain=/);
  assert.deepEqual(Object.keys(data).sort(), ['expiresAt', 'username']);
  assert.equal(data.username, 'noart');
  assert.ok(Math.abs(data.expiresAt - Date.now() - SESSION_MS) < 5000);
  assert.equal((await app.request('/api/links', withCookie(cookie))).status, 200);
  const home = await app.request('/', withCookie(cookie));
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('cache-control'), 'no-store');
  assert.match(await home.text(), /id="logout-button"/);
  const redirect = await app.request('/login', withCookie(cookie));
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/');
  for (const path of ['/api/auth/register', '/api/users']) {
    assert.equal((await app.request(path, withCookie(cookie, post(credentials)))).status, 404);
  }
  const file = await readFile(join(app.directory, 'sessions.json'), 'utf8');
  assert.equal(file.includes(cookie.split('=')[1]), false);
  assert.equal(file.includes(TEST_PASSWORD), false);
  const records = JSON.parse(file).sessions;
  assert.match(records[0].tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(records[0].expiresAt, data.expiresAt);
  assert.equal((await stat(join(app.directory, 'sessions.json'))).mode & 0o777, 0o600);
  const tampered = cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A');
  for (const invalid of [tampered, 'appgather_session=invalid', 'appgather_session=%ZZ']) {
    assert.equal((await app.request('/api/links', withCookie(invalid))).status, 401);
  }
});

test('登录 30 天后准确失效，期间访问和服务重启不延长到期时间', async t => {
  const initial = Date.now();
  let timestamp = initial;
  const app = await fixture(t, { now: () => timestamp });
  const { cookie, data } = await login(app);
  assert.equal(data.expiresAt, initial + SESSION_MS);
  timestamp += SESSION_MS / 2;
  let response = await app.request('/api/auth/session', withCookie(cookie));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).expiresAt, data.expiresAt);
  assert.equal(response.headers.get('set-cookie'), null);
  await app.restart();
  timestamp = initial + SESSION_MS - 1;
  assert.equal((await app.request('/api/links', withCookie(cookie))).status, 200);
  timestamp += 1;
  assert.equal((await app.request('/api/links', withCookie(cookie))).status, 401);
  assert.equal((await app.request('/', withCookie(cookie))).headers.get('location'), '/login');
  await app.restart();
  assert.equal((await app.request('/api/auth/session', withCookie(cookie))).status, 401);
});

test('会话重启后保留，退出清除 Cookie 并永久撤销当前令牌，其他设备不受影响', async t => {
  const app = await fixture(t);
  const first = await login(app);
  const second = await login(app);
  assert.notEqual(first.cookie, second.cookie);
  await app.restart();
  assert.equal((await app.request('/api/auth/session', withCookie(first.cookie))).status, 200);
  const logout = await app.request('/api/auth/logout', withCookie(first.cookie, { method: 'POST' }));
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /appgather_session=;.*Max-Age=0;/);
  assert.equal((await app.request('/api/links', withCookie(first.cookie))).status, 401);
  assert.equal((await app.request('/api/links', withCookie(second.cookie))).status, 200);
  await app.restart();
  assert.equal((await app.request('/api/links', withCookie(first.cookie))).status, 401);
  assert.equal((await app.request('/api/links', withCookie(second.cookie))).status, 200);
  assert.equal((await app.request('/api/auth/logout', { method: 'POST' })).status, 204);
});

test('连续错误登录会限速，等待窗口后可以重新登录', async t => {
  let timestamp = Date.now();
  const app = await fixture(t, { now: () => timestamp });
  for (let index = 0; index < 5; index++) {
    assert.equal((await app.request('/api/auth/login', post({ ...credentials, password: 'wrong' }))).status, 401);
  }
  const blocked = await app.request('/api/auth/login', post(credentials));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '900');
  assert.equal(blocked.headers.get('set-cookie'), null);
  timestamp += 15 * 60 * 1000;
  await login(app);
});

test('拒绝跨站登录和退出，HTTPS 反向代理使用 Secure Cookie', async t => {
  const app = await fixture(t);
  for (const headers of [{ Origin: 'https://other.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const options = post(credentials);
    options.headers = { ...options.headers, ...headers };
    const response = await app.request('/api/auth/login', options);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const { cookie, setCookie } = await login(app, {
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
  });
  assert.match(setCookie, /; Secure$/);
  const rejected = await app.request('/api/auth/logout', {
    method: 'POST', headers: { Cookie: cookie, Origin: 'https://other.example' },
  });
  assert.equal(rejected.status, 403);
  assert.equal((await app.request('/api/links', withCookie(cookie))).status, 200);
});
