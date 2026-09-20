import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../backend/server.js';

async function start(dataDir) {
  const server = await createApp({ dataDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    request: (path, options) => fetch(`${base}${path}`, options),
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

const post = data => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

test('网页可以添加、持久化、重启后读取、删除', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'appgather-'));
  let app = await start(directory);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

  assert.deepEqual(await (await app.request('/api/links')).json(), { links: [] });
  const response = await app.request('/api/links', post({ name: ' 我的网盘 ', url: 'http://192.168.0.150:16025/目录?q=学习' }));
  assert.equal(response.status, 201);
  const { link } = await response.json();
  assert.equal(link.name, '我的网盘');
  assert.equal(new URL(link.url).port, '16025');
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'links.json'), 'utf8')), [link]);

  await app.close();
  app = await start(directory);
  assert.deepEqual((await (await app.request('/api/links')).json()).links, [link]);
  assert.equal((await app.request(`/api/links/${link.id}`, { method: 'DELETE' })).status, 204);
  await app.close();
  app = await start(directory);
  assert.deepEqual((await (await app.request('/api/links')).json()).links, []);
});

test('并发添加与删除不会覆盖彼此的数据', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'appgather-parallel-'));
  const app = await start(directory);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

  const added = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
    const response = await app.request('/api/links', post({ name: `网页 ${index}`, url: `https://example.com/${index}` }));
    assert.equal(response.status, 201);
    return (await response.json()).link;
  }));
  const [removed, newResponse] = await Promise.all([
    app.request(`/api/links/${added[0].id}`, { method: 'DELETE' }),
    app.request('/api/links', post({ name: '新网页', url: 'https://example.com/new' })),
  ]);
  assert.equal(removed.status, 204);
  assert.equal(newResponse.status, 201);
  const { links } = await (await app.request('/api/links')).json();
  assert.equal(links.length, 12);
  assert.equal(new Set(links.map(link => link.id)).size, 12);
  assert.equal(links.some(link => link.id === added[0].id), false);
  assert.equal(links.some(link => link.name === '新网页'), true);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'links.json'), 'utf8')), links);
});

test('无效协议、跨站修改和直接读取数据文件被拒绝，静态页面正常返回', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'appgather-boundary-'));
  const app = await start(directory);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:password@example.com']) {
    assert.equal((await app.request('/api/links', post({ name: '网页', url }))).status, 400);
  }
  const crossSite = post({ name: '网页', url: 'https://example.com' });
  crossSite.headers.Origin = 'https://another-site.example';
  assert.equal((await app.request('/api/links', crossSite)).status, 403);
  assert.equal((await app.request('/backend/data/links.json')).status, 404);
  assert.equal((await app.request('/../package.json')).status, 404);
  assert.equal((await app.request('/api/links/missing', { method: 'DELETE' })).status, 404);
  const html = await app.request('/');
  assert.match(html.headers.get('content-type'), /text\/html/);
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await html.text(), /AppGather/);
  for (const path of ['/app.js', '/styles.css', '/favicon.svg']) {
    assert.equal((await app.request(path)).status, 200);
  }
  const text = '<img src=x onerror=alert(1)>';
  const { link } = await (await app.request('/api/links', post({ name: text, url: 'https://example.com' }))).json();
  assert.equal(link.name, text);
});
