import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStore, DEFAULT_TAG_ID } from './store.js';
import { createAuth } from './auth.js';

const here = dirname(fileURLToPath(import.meta.url));

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw fail(415, '请使用 JSON 提交信息');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw fail(413, '提交的内容太长了');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw fail(400, '提交的信息格式不正确');
  }
}

function parseLink(input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const address = typeof input?.url === 'string' ? input.url.trim() : '';
  if (!name || name.length > 60) throw fail(400, '请输入 1–60 个字符的网页名称');
  if (!address || address.length > 2048) throw fail(400, '请输入有效的网址');
  let url;
  try {
    url = new URL(address);
  } catch {
    throw fail(400, '网址需要以 http:// 或 https:// 开头');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw fail(400, '请使用不包含账号密码的 HTTP 或 HTTPS 网址');
  }
  return { name, url: url.href };
}

function requireTag(data, id) {
  const tag = data.tags.find(item => item.id === id);
  if (!tag) throw fail(404, '这个标签不存在，请刷新页面后重试');
  return tag;
}

function parseCollapsed(input) {
  if (typeof input?.collapsed !== 'boolean') throw fail(400, '请指定折叠或展开状态');
  return input.collapsed;
}

export async function createApp({ dataDir = process.env.DATA_DIR || join(here, 'data'), authOptions } = {}) {
  const store = await createStore(dataDir);
  const auth = await createAuth(dataDir, authOptions);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/login', 'login.html', 'text/html; charset=utf-8'],
    ['/login.js', 'login.js', 'text/javascript; charset=utf-8'],
    ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
    ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
    ['/favicon.svg', 'favicon.svg', 'image/svg+xml'],
  ].map(async ([route, file, type]) => [route, {
    body: await readFile(join(here, '..', 'public', file)), type,
  }])));

  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' http: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const { pathname } = new URL(request.url, 'http://localhost');

      if (['POST', 'PATCH', 'DELETE'].includes(request.method)) {
        // 登录、退出和数据修改都只允许同站浏览器请求。
        const origin = request.headers.origin;
        let originHost;
        try { originHost = origin && new URL(origin).host; } catch { throw fail(403, '请在 AppGather 页面内操作'); }
        if (request.headers['sec-fetch-site'] === 'cross-site' ||
            (origin && originHost !== request.headers.host)) {
          throw fail(403, '请在 AppGather 页面内操作');
        }
      }

      if (pathname === '/api/health' && request.method === 'GET') {
        return sendJson(response, 200, { status: 'ok' });
      }
      if (pathname === '/api/auth/login' && request.method === 'POST') {
        return sendJson(response, 200, await auth.login(request, response, await readJson(request)));
      }
      if (pathname === '/api/auth/logout' && request.method === 'POST') {
        await auth.logout(request, response);
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        return response.end();
      }
      const session = auth.session(request);
      // Gate every data API centrally, including routes added in the future.
      if (pathname.startsWith('/api/') && !session) throw fail(401, '请先登录 AppGather');
      if (pathname === '/api/auth/session' && request.method === 'GET') {
        return sendJson(response, 200, session);
      }
      if (pathname === '/api/links' && request.method === 'GET') {
        return sendJson(response, 200, store.list());
      }
      if (pathname === '/api/links' && request.method === 'POST') {
        const input = await readJson(request);
        const link = {
          id: randomUUID(), ...parseLink(input), tagId: input.tagId ?? DEFAULT_TAG_ID,
          starred: false, createdAt: new Date().toISOString(),
        };
        let tag;
        await store.change(data => {
          tag = { ...requireTag(data, link.tagId), collapsed: false };
          return {
            tags: data.tags.map(item => item.id === tag.id ? tag : item),
            links: [...data.links, link],
          };
        });
        return sendJson(response, 201, { link, tag });
      }
      if (pathname.startsWith('/api/links/') && request.method === 'PATCH') {
        const id = pathname.slice('/api/links/'.length);
        const input = await readJson(request) || {};
        const has = key => Object.hasOwn(input, key);
        if (has('starred') && typeof input.starred !== 'boolean') throw fail(400, '星标状态需要为 true 或 false');
        let link;
        let tag;
        await store.change(data => {
          const existing = data.links.find(item => item.id === id);
          if (!existing) throw fail(404, '这个网页已经被移除了');
          link = { ...existing };
          if (has('name') || has('url')) {
            Object.assign(link, parseLink({
              name: has('name') ? input.name : existing.name,
              url: has('url') ? input.url : existing.url,
            }));
          }
          if (has('starred')) link.starred = input.starred;
          if (has('tagId')) link.tagId = input.tagId;
          tag = requireTag(data, link.tagId);
          // 只有移动到其他标签时才展开目标标签；星标和文字编辑不改变折叠状态。
          const moved = link.tagId !== existing.tagId;
          if (moved) tag = { ...tag, collapsed: false };
          return {
            ...data,
            tags: moved ? data.tags.map(item => item.id === tag.id ? tag : item) : data.tags,
            links: data.links.map(item => item.id === id ? link : item),
          };
        });
        return sendJson(response, 200, { link, tag });
      }
      if (pathname.startsWith('/api/links/') && request.method === 'DELETE') {
        const id = pathname.slice('/api/links/'.length);
        await store.change(data => {
          if (!data.links.some(link => link.id === id)) throw fail(404, '这个网页已经被移除了');
          return { ...data, links: data.links.filter(link => link.id !== id) };
        });
        response.writeHead(204);
        return response.end();
      }
      if (pathname === '/api/tags' && request.method === 'POST') {
        const input = await readJson(request);
        const name = typeof input?.name === 'string' ? input.name.trim() : '';
        if (!name || name.length > 60) throw fail(400, '请输入 1–60 个字符的标签名称');
        const tag = { id: randomUUID(), name, collapsed: false, createdAt: new Date().toISOString() };
        await store.change(data => {
          if (data.tags.some(item => item.name === name)) throw fail(409, '这个标签名称已经存在');
          return { ...data, tags: [...data.tags, tag] };
        });
        return sendJson(response, 201, { tag });
      }
      if (pathname === '/api/tags' && request.method === 'PATCH') {
        const collapsed = parseCollapsed(await readJson(request));
        await store.change(data => ({ ...data, tags: data.tags.map(tag => ({ ...tag, collapsed })) }));
        return sendJson(response, 200, { tags: store.list().tags });
      }
      if (pathname.startsWith('/api/tags/') && request.method === 'PATCH') {
        const id = pathname.slice('/api/tags/'.length);
        const collapsed = parseCollapsed(await readJson(request));
        let tag;
        await store.change(data => {
          tag = { ...requireTag(data, id), collapsed };
          return { ...data, tags: data.tags.map(item => item.id === id ? tag : item) };
        });
        return sendJson(response, 200, { tag });
      }
      if (pathname.startsWith('/api/')) throw fail(404, '接口不存在');

      const route = pathname === '/index.html' ? '/' : pathname === '/login.html' ? '/login' : pathname;
      const asset = assets.get(route);
      if (!asset) throw fail(404, '页面不存在');
      if (!['GET', 'HEAD'].includes(request.method)) throw fail(405, '不支持此请求方式');
      if ((route === '/' && !session) || (route === '/login' && session)) {
        response.writeHead(302, { Location: session ? '/' : '/login', 'Cache-Control': 'no-store' });
        return response.end();
      }
      if (route === '/app.js' && !session) throw fail(401, '请先登录 AppGather');
      response.writeHead(200, {
        'Content-Type': asset.type,
        'Content-Length': asset.body.length,
        'Cache-Control': ['/', '/login', '/app.js', '/login.js'].includes(route) ? 'no-store' : 'no-cache',
      });
      response.end(request.method === 'HEAD' ? undefined : asset.body);
    } catch (error) {
      if (!error.status) console.error(error);
      if (!response.headersSent && !response.destroyed) {
        if (error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
        sendJson(response, error.status || 500, {
          error: error.status ? error.message : '保存失败，请稍后重试',
        });
      }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await createApp();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3050);
  server.listen(port, host, () => console.log(`AppGather: http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    });
  }
}
