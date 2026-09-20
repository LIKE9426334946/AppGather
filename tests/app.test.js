import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const patch = data => ({ ...post(data), method: 'PATCH' });

test('网页可以添加、持久化、重启后读取、删除', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'appgather-'));
  let app = await start(directory);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

  assert.deepEqual((await (await app.request('/api/links')).json()).links, []);
  const response = await app.request('/api/links', post({ name: ' 我的网盘 ', url: 'http://192.168.0.150:16025/目录?q=学习' }));
  assert.equal(response.status, 201);
  const { link } = await response.json();
  assert.equal(link.name, '我的网盘');
  assert.equal(new URL(link.url).port, '16025');
  assert.equal(link.tagId, 'default');
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'links.json'), 'utf8')).links, [link]);

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
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'links.json'), 'utf8')).links, links);
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
  assert.equal((await app.request('/api/tags', { ...crossSite, method: 'PATCH', body: JSON.stringify({ collapsed: true }) })).status, 403);
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

test('旧网页数组自动归入未分类，原文件备份与网页信息完整保留，重复启动不重复迁移', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'appgather-migrate-'));
  const oldLinks = [
    { id: 'old-1', name: '我的网盘', url: 'http://192.168.0.150:16025/', createdAt: '2026-09-20T13:00:00Z' },
    { id: 'old-2', name: '学习网页', url: 'https://example.com/path?q=%E5%AD%A6%E4%B9%A0#section' },
  ];
  const originalFile = `${JSON.stringify(oldLinks, null, 2)}\n`;
  await writeFile(join(directory, 'links.json'), originalFile);
  let app = await start(directory);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

  const state = await (await app.request('/api/links')).json();
  assert.deepEqual(state.links, oldLinks.map(link => ({ ...link, tagId: 'default' })));
  assert.deepEqual(state.tags, [{ id: 'default', name: '未分类', collapsed: false }]);
  assert.equal(await readFile(join(directory, 'links.before-tags.json'), 'utf8'), originalFile);
  assert.equal((await app.request('/api/tags/default', patch({ collapsed: true }))).status, 200);

  await app.close();
  app = await start(directory);
  const restored = await (await app.request('/api/links')).json();
  assert.deepEqual(restored.links, state.links);
  assert.equal(restored.tags.length, 1);
  assert.equal(restored.tags[0].collapsed, true);
  assert.equal(await readFile(join(directory, 'links.before-tags.json'), 'utf8'), originalFile);
});

test('多个标签容纳网页、移动网页、单独和全部折叠展开，并在重启后保留状态', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'appgather-tags-'));
  let app = await start(directory);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const createTag = async name => {
    const response = await app.request('/api/tags', post({ name }));
    assert.equal(response.status, 201);
    return (await response.json()).tag;
  };
  const myApps = await createTag('我的App');
  const learning = await createTag('学习');
  const readState = async () => (await app.request('/api/links')).json();
  assert.equal((await readState()).links.length, 0);

  const added = await Promise.all(['网页 A', '网页 B', '网页 C'].map(async name => {
    const response = await app.request('/api/links', post({ name, url: 'https://example.com', tagId: myApps.id }));
    assert.equal(response.status, 201);
    return (await response.json()).link;
  }));
  assert.equal((await readState()).links.filter(link => link.tagId === myApps.id).length, 3);
  await app.request(`/api/tags/${myApps.id}`, patch({ collapsed: true }));
  let state = await readState();
  assert.equal(state.tags.find(tag => tag.id === myApps.id).collapsed, true);
  assert.equal(state.tags.find(tag => tag.id === learning.id).collapsed, false);

  await app.close();
  app = await start(directory);
  assert.equal((await readState()).tags.find(tag => tag.id === myApps.id).collapsed, true);
  await app.request(`/api/tags/${myApps.id}`, patch({ collapsed: false }));
  assert.equal((await readState()).tags.find(tag => tag.id === myApps.id).collapsed, false);

  await app.request('/api/tags', patch({ collapsed: true }));
  assert.equal((await readState()).tags.every(tag => tag.collapsed), true);
  const moved = await app.request(`/api/links/${added[0].id}`, patch({ tagId: learning.id }));
  assert.equal(moved.status, 200);
  state = await readState();
  assert.deepEqual(state.links.find(link => link.id === added[0].id), { ...added[0], tagId: learning.id });
  assert.equal(state.tags.find(tag => tag.id === learning.id).collapsed, false);
  assert.equal(state.tags.find(tag => tag.id === myApps.id).collapsed, true);

  await app.request('/api/tags', patch({ collapsed: false }));
  await app.close();
  app = await start(directory);
  state = await readState();
  assert.equal(state.tags.every(tag => !tag.collapsed), true);
  assert.equal(state.links.filter(link => link.tagId === myApps.id).length, 2);
  assert.equal(state.links.filter(link => link.tagId === learning.id).length, 1);

  assert.equal((await app.request('/api/tags', post({ name: ' 我的App ' }))).status, 409);
  assert.equal((await app.request('/api/tags', patch({ collapsed: 'false' }))).status, 400);
  assert.equal((await app.request('/api/links', post({ name: '无效标签', url: 'https://example.com', tagId: 'missing' }))).status, 404);
  assert.equal((await app.request(`/api/links/${added[0].id}`, patch({ tagId: 'missing' }))).status, 404);
  assert.deepEqual(await readState(), state);
});

test('旧网页支持星标和单字段编辑，保留身份与折叠状态，重启后仍生效', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'appgather-stars-'));
  const original = { id: 'existing-link', name: '原名称', url: 'https://example.com/old', tagId: 'default', createdAt: '2026-09-20T13:00:00Z' };
  const oldData = { tags: [{ id: 'default', name: '未分类', collapsed: true }], links: [original] };
  await writeFile(join(directory, 'links.json'), JSON.stringify(oldData));
  let app = await start(directory);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const readState = async () => (await app.request('/api/links')).json();
  const url = `/api/links/${original.id}`;

  assert.deepEqual(await readState(), oldData);
  let response = await app.request(url, patch({ starred: true }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).link.starred, true);
  assert.equal((await readState()).tags[0].collapsed, true);

  response = await app.request(url, patch({ name: '  新名称  ' }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).link, { ...original, name: '新名称', starred: true });
  response = await app.request(url, patch({ url: 'http://192.168.0.150:16050/path' }));
  assert.equal(response.status, 200);
  const expected = { ...original, name: '新名称', url: 'http://192.168.0.150:16050/path', starred: true };
  assert.deepEqual((await response.json()).link, expected);

  await app.close();
  app = await start(directory);
  const state = await readState();
  assert.deepEqual(state.links, [expected]);
  assert.deepEqual(state.tags, oldData.tags);

  assert.equal((await app.request(url, patch({ name: '不应保存', url: 'javascript:alert(1)' }))).status, 400);
  assert.equal((await app.request(url, patch({ starred: 'false' }))).status, 400);
  assert.deepEqual(await readState(), state);
  response = await app.request(url, patch({ starred: false, id: 'replacement-id', createdAt: 'replacement-date' }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).link, { ...expected, starred: false });
  await app.close();
  app = await start(directory);
  assert.deepEqual((await readState()).links, [{ ...expected, starred: false }]);
});

test('并发修改名称、网址、标签和星标不会覆盖其他字段或改变原顺序', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'appgather-edit-'));
  const app = await start(directory);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const { tag } = await (await app.request('/api/tags', post({ name: '目标标签' }))).json();
  const { link } = await (await app.request('/api/links', post({ name: '原名称', url: 'https://example.com' }))).json();
  const { link: second } = await (await app.request('/api/links', post({ name: '第二个网页', url: 'https://example.org' }))).json();
  assert.equal(link.starred, false);

  const updates = [{ name: '新名称' }, { url: 'https://example.net/updated' }, { tagId: tag.id }, { starred: true }];
  const responses = await Promise.all(updates.map(update => app.request(`/api/links/${link.id}`, patch(update))));
  assert.ok(responses.every(response => response.status === 200));
  const state = await (await app.request('/api/links')).json();
  assert.deepEqual(state.links, [
    { ...link, name: '新名称', url: 'https://example.net/updated', tagId: tag.id, starred: true },
    second,
  ]);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'links.json'), 'utf8')), state);
});
