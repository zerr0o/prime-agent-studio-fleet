// Prime Fleet web relay. Dependency-free Node ES module.
// Serves the web build (dist/) and forwards /relay/api/v1/* to a Prime Agent Studio.
// Studio refuses cross-origin browser calls, so the browser talks to this relay instead.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = path.resolve(HERE, '..', 'dist');
const DEFAULT_ORIGINS = ['http://localhost:8081', 'http://127.0.0.1:8081'];
const HEADERS_TIMEOUT_MS = 15_000;

const FORWARD_REQUEST = [
  'authorization', 'content-type', 'accept', 'last-event-id', 'range', 'if-range', 'if-match',
  'if-none-match', 'if-modified-since', 'if-unmodified-since', 'content-length',
];
const FORWARD_RESPONSE = [
  'content-type', 'cache-control', 'etag', 'last-modified', 'content-range', 'accept-ranges',
  'content-length', 'content-disposition', 'www-authenticate', 'allow', 'x-accel-buffering',
];
const CORS_ALLOW_HEADERS = 'authorization, content-type, x-studio-target, last-event-id, range, if-range, if-match, if-none-match, if-modified-since, if-unmodified-since';
const CORS_EXPOSE_HEADERS = 'content-type, etag, last-modified, content-range, accept-ranges, content-length, content-disposition';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

const MISSING_DIST_PAGE = `<!doctype html><meta charset="utf-8"><title>Prime Fleet relay</title>
<body style="font:14px system-ui;background:#111;color:#ddd;padding:2em">
<h1 style="font-size:16px">Prime Fleet relay is running</h1>
<p>The web build was not found. Run <code>npm run build:web</code>, then reload this page.</p></body>`;

function sendJson(res, status, body, extra = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    ...extra,
  });
  res.end(data);
}

/** Returns a URL for an acceptable Studio target, or null. */
export function parseTarget(value) {
  if (typeof value !== 'string' || !value || value.length > 300) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.pathname !== '/' || url.search || url.hash) return null;
  const https_ = url.protocol === 'https:';
  const host = url.hostname.toLowerCase();
  if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') return url;
  if (host.endsWith('.ts.net') && host.length > '.ts.net'.length && !host.includes('..')) {
    return https_ && !url.port ? url : null;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 100 && b >= 64 && b <= 127) return url;
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return url;
  return null;
}

function isLoopbackHostHeader(hostHeader) {
  const host = String(hostHeader || '').toLowerCase().replace(/:\d+$/, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

export function startRelay({
  port = 8790, host = '127.0.0.1', dist, allowOrigins = DEFAULT_ORIGINS, headersTimeoutMs = HEADERS_TIMEOUT_MS,
} = {}) {
  const distRoot = path.resolve(dist ?? DEFAULT_DIST);
  const origins = new Set(allowOrigins.map((o) => o.replace(/\/+$/, '')));
  const loopbackBind = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);

  function originVerdict(req) {
    const origin = req.headers.origin;
    if (loopbackBind && !isLoopbackHostHeader(req.headers.host)) return { ok: false };
    if (origin === undefined) return { ok: true };
    if (origins.has(origin)) return { ok: true, cors: origin };
    const h = req.headers.host;
    if (h && (origin === `http://${h}` || origin === `https://${h}`)) return { ok: true };
    return { ok: false };
  }

  function corsHeaders(origin) {
    if (!origin) return {};
    return {
      'access-control-allow-origin': origin,
      vary: 'Origin',
      'access-control-allow-headers': CORS_ALLOW_HEADERS,
      'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
      'access-control-expose-headers': CORS_EXPOSE_HEADERS,
      'access-control-max-age': '600',
    };
  }

  function proxy(req, res, pathAndQuery, cors) {
    const raw = req.headers['x-studio-target'];
    if (raw === undefined || raw === '') {
      return sendJson(res, 400, { error: 'The X-Studio-Target header is missing.', code: 'relay_target_missing' }, cors);
    }
    const target = parseTarget(Array.isArray(raw) ? raw.join(',') : raw);
    if (!target) {
      return sendJson(res, 400, { error: 'This Studio address is not allowed.', code: 'relay_target_invalid' }, cors);
    }
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) {
      return sendJson(res, 405, { error: 'Method not allowed.', code: 'relay_method_not_allowed' }, { ...cors, allow: 'GET, HEAD, POST, OPTIONS' });
    }
    const headers = {};
    for (const name of FORWARD_REQUEST) if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    headers.host = target.host;

    const lib = target.protocol === 'https:' ? https : http;
    let answered = false;
    const upstream = lib.request({
      protocol: target.protocol,
      hostname: target.hostname.replace(/^\[|\]$/g, ''),
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: pathAndQuery,
      headers,
    });
    const timer = setTimeout(() => upstream.destroy(new Error('headers timeout')), headersTimeoutMs);

    const fail = () => {
      clearTimeout(timer);
      if (res.headersSent) { res.destroy(); return; }
      if (answered) return;
      answered = true;
      sendJson(res, 502, { error: 'The Studio could not be reached.', code: 'relay_unreachable' }, cors);
    };
    upstream.on('error', fail);
    upstream.on('response', (up) => {
      clearTimeout(timer);
      answered = true;
      up.on('error', () => res.destroy());
      const out = { ...cors };
      for (const name of FORWARD_RESPONSE) if (up.headers[name] !== undefined) out[name] = up.headers[name];
      const sse = String(up.headers['content-type'] || '').toLowerCase().startsWith('text/event-stream');
      if (sse) {
        out['cache-control'] = 'no-cache, no-transform';
        out['x-accel-buffering'] = 'no';
        delete out['content-length'];
        req.socket.setNoDelay(true);
        req.socket.setKeepAlive(true);
        up.socket?.setTimeout(0);
      }
      res.writeHead(up.statusCode ?? 502, out);
      if (sse) res.flushHeaders();
      up.pipe(res);
    });
    // The browser went away before the answer ended: close the upstream request.
    res.on('close', () => {
      clearTimeout(timer);
      if (!res.writableFinished) upstream.destroy();
    });
    req.on('error', () => upstream.destroy());
    req.pipe(upstream);
  }

  function statFile(file) {
    try { return fs.statSync(file); } catch { return null; }
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Method not allowed.', code: 'relay_method_not_allowed' }, { allow: 'GET, HEAD' });
    }
    const secure = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
    const indexFile = path.join(distRoot, 'index.html');
    if (!statFile(indexFile)?.isFile()) {
      if (pathname === '/' || (req.headers.accept || '').includes('text/html')) {
        res.writeHead(200, { ...secure, 'content-type': MIME['.html'], 'cache-control': 'no-store' });
        return res.end(req.method === 'HEAD' ? undefined : MISSING_DIST_PAGE);
      }
      return sendJson(res, 404, { error: 'Not found.', code: 'not_found' });
    }
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return sendJson(res, 400, { error: 'Bad path.', code: 'bad_path' }); }
    if (decoded.includes('\0')) return sendJson(res, 400, { error: 'Bad path.', code: 'bad_path' });
    const candidate = path.resolve(distRoot, '.' + path.sep + decoded.replace(/^[/\\]+/, ''));
    if (candidate !== distRoot && !candidate.startsWith(distRoot + path.sep)) {
      return sendJson(res, 403, { error: 'Forbidden.', code: 'forbidden' });
    }
    let file = candidate;
    let st = statFile(file);
    if (st?.isDirectory()) { file = path.join(file, 'index.html'); st = statFile(file); }
    if (!st?.isFile() && !path.extname(candidate)) {
      const html = statFile(candidate + '.html');
      if (html?.isFile()) { file = candidate + '.html'; st = html; }
    }
    if (!st?.isFile()) {
      if (!(req.headers.accept || '').includes('text/html')) return sendJson(res, 404, { error: 'Not found.', code: 'not_found' });
      file = indexFile;
      st = statFile(file);
    }
    const rel = path.relative(distRoot, file).split(path.sep).join('/');
    const ext = path.extname(file).toLowerCase();
    const cache = rel.startsWith('_expo/static/') ? 'public, max-age=31536000, immutable'
      : ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, {
      ...secure,
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': st.size,
      'last-modified': st.mtime.toUTCString(),
      'cache-control': cache,
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://relay.local'); } catch { return sendJson(res, 400, { error: 'Bad request.', code: 'bad_request' }); }
    const pathname = url.pathname;

    if (pathname === '/relay' || pathname.startsWith('/relay/')) {
      const verdict = originVerdict(req);
      if (!verdict.ok) return sendJson(res, 403, { error: 'This origin is not allowed.', code: 'relay_origin_forbidden' });
      const cors = corsHeaders(verdict.cors);
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (pathname === '/relay/health') return sendJson(res, 200, { ok: true }, cors);
      if (pathname.startsWith('/relay/api/v1/') || pathname === '/relay/api/v1') {
        return proxy(req, res, pathname.slice('/relay'.length) + url.search, cors);
      }
      return sendJson(res, 404, { error: 'Not found.', code: 'not_found' }, cors);
    }
    serveStatic(req, res, pathname);
  });
  server.requestTimeout = 0;
  server.headersTimeout = 30_000;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const shown = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
      resolve({
        url: `http://${shown}:${addr.port}`,
        close: () => new Promise((done) => { server.close(() => done()); server.closeAllConnections(); }),
      });
    });
  });
}

function parseArgs(argv) {
  const opts = { allowOrigins: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--port') opts.port = Number(next());
    else if (a === '--host') opts.host = next();
    else if (a === '--dist') opts.dist = path.resolve(next());
    else if (a === '--allow-origin') opts.allowOrigins.push(next());
    else if (a === '--help' || a === '-h') {
      console.log('node relay/server.mjs [--port 8790] [--host 127.0.0.1] [--dist dist] [--allow-origin <origin>]...');
      process.exit(0);
    } else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  opts.allowOrigins = [...new Set([...DEFAULT_ORIGINS, ...opts.allowOrigins])];
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = parseArgs(process.argv.slice(2));
  const relay = await startRelay(opts);
  console.log(`Prime Fleet relay listening on ${relay.url}`);
  const stop = () => relay.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
