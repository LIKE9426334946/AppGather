import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStore } from './store.js';

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
    throw fail(415, '请使用 JSON 提交网页信息');
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
    throw fail(400, '网页信息格式不正确');
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
  return { id: randomUUID(), name, url: url.href, createdAt: new Date().toISOString() };
}

export async function createApp({ dataDir = process.env.DATA_DIR || join(here, 'data') } = {}) {
  const store = await createStore(dataDir);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
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

      if (['POST', 'DELETE'].includes(request.method)) {
        // 阻止其他网站在浏览器中跨站修改；不引入用户账号系统。
        const origin = request.headers.origin;
        if (request.headers['sec-fetch-site'] === 'cross-site' ||
            (origin && new URL(origin).host !== request.headers.host)) {
          throw fail(403, '请在 AppGather 页面内操作');
        }
      }

      if (pathname === '/api/health' && request.method === 'GET') {
        return sendJson(response, 200, { status: 'ok' });
      }
      if (pathname === '/api/links' && request.method === 'GET') {
        return sendJson(response, 200, { links: store.list() });
      }
      if (pathname === '/api/links' && request.method === 'POST') {
        const link = parseLink(await readJson(request));
        await store.change(links => [...links, link]);
        return sendJson(response, 201, { link });
      }
      if (pathname.startsWith('/api/links/') && request.method === 'DELETE') {
        const id = pathname.slice('/api/links/'.length);
        await store.change(links => {
          if (!links.some(link => link.id === id)) throw fail(404, '这个网页已经被移除了');
          return links.filter(link => link.id !== id);
        });
        response.writeHead(204);
        return response.end();
      }
      if (pathname.startsWith('/api/')) throw fail(404, '接口不存在');

      const asset = assets.get(pathname === '/index.html' ? '/' : pathname);
      if (!asset) throw fail(404, '页面不存在');
      if (!['GET', 'HEAD'].includes(request.method)) throw fail(405, '不支持此请求方式');
      response.writeHead(200, {
        'Content-Type': asset.type,
        'Content-Length': asset.body.length,
        'Cache-Control': 'no-cache',
      });
      response.end(request.method === 'HEAD' ? undefined : asset.body);
    } catch (error) {
      if (!error.status) console.error(error);
      if (!response.headersSent && !response.destroyed) {
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
