import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Relay = { url: string; close(): Promise<void> };
const relayModule = '../relay/server.mjs';
const { startRelay, parseTarget } = (await import(/* @vite-ignore */ relayModule)) as {
  startRelay(o?: Record<string, unknown>): Promise<Relay>;
  parseTarget(v: string): URL | null;
};

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
type Res = { status: number; headers: http.IncomingHttpHeaders; body: string };

function request(
  base: string, method: string, p: string, headers: Record<string, string> = {}, body?: string,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request(
      { hostname: u.hostname, port: u.port, method, path: p, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let upstream: http.Server;
let upstreamUrl = '';
let seen: Seen[] = [];
let sseClosed = false;
let sseTimer: NodeJS.Timeout | undefined;
let relay: Relay;
let dist: string;
let distMissing: string;
let staticRelay: Relay;
let emptyRelay: Relay;

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (req.url?.startsWith('/api/v1/stream')) {
        sseClosed = false;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write('id: 1\ndata: {"a":1}\n\n');
        sseTimer = setTimeout(() => { res.write('id: 2\ndata: {"a":2}\n\n'); res.end(); }, 1500);
        res.on('close', () => { sseClosed = true; clearTimeout(sseTimer); });
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'a=b',
        'x-secret': 'leak',
        etag: '"v1"',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify({ hello: 'studio' }));
    });
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as net.AddressInfo).port}`;

  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-dist-'));
  fs.mkdirSync(path.join(dist, '_expo', 'static', 'js'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
  fs.writeFileSync(path.join(dist, '_expo', 'static', 'js', 'app-1.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, 'favicon.ico'), 'ico');
  fs.writeFileSync(path.join(dist, 'font.woff2'), 'font');
  fs.writeFileSync(path.join(path.dirname(dist), 'pf-secret.txt'), 'secret');
  distMissing = path.join(os.tmpdir(), 'pf-dist-missing-' + Date.now());

  relay = await startRelay({ port: 0, dist: distMissing });
  staticRelay = await startRelay({ port: 0, dist, headersTimeoutMs: 400 });
  emptyRelay = await startRelay({ port: 0, dist: distMissing, allowOrigins: ['http://localhost:9999'] });
});

afterAll(async () => {
  await Promise.all([relay?.close(), staticRelay?.close(), emptyRelay?.close()]);
  await new Promise<void>((r) => { clearTimeout(sseTimer); upstream.closeAllConnections(); upstream.close(() => r()); });
  fs.rmSync(dist, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(dist), 'pf-secret.txt'), { force: true });
});

describe('health and CORS', () => {
  it('answers /relay/health', async () => {
    const r = await request(relay.url, 'GET', '/relay/health');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
  });

  it('allows requests without Origin, with relay origin and with default dev origins', async () => {
    const host = new URL(relay.url).host;
    for (const origin of [undefined, `http://${host}`, 'http://localhost:8081', 'http://127.0.0.1:8081']) {
      const r = await request(relay.url, 'GET', '/relay/health', origin ? { origin } : {});
      expect(r.status).toBe(200);
    }
  });

  it('adds CORS headers only for allowed dev origins', async () => {
    const dev = await request(relay.url, 'GET', '/relay/health', { origin: 'http://localhost:8081' });
    expect(dev.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(dev.headers.vary).toContain('Origin');
    expect(dev.headers['access-control-expose-headers']).toContain('etag');
    const plain = await request(relay.url, 'GET', '/relay/health');
    expect(plain.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects other origins with 403', async () => {
    for (const origin of ['http://evil.example', 'null', 'http://localhost:8082']) {
      const r = await request(relay.url, 'GET', '/relay/health', { origin });
      expect(r.status).toBe(403);
      expect(JSON.parse(r.body).code).toBe('relay_origin_forbidden');
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('rejects a foreign Host header on a loopback bind', async () => {
    const r = await request(relay.url, 'GET', '/relay/health', { host: 'evil.example' });
    expect(r.status).toBe(403);
  });

  it('answers the preflight with 204', async () => {
    const r = await request(relay.url, 'OPTIONS', '/relay/api/v1/machine', {
      origin: 'http://localhost:8081',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization, x-studio-target',
    });
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(r.headers['access-control-allow-headers']).toContain('x-studio-target');
    expect(r.headers['access-control-allow-methods']).toBe('GET, HEAD, POST, OPTIONS');
    const bad = await request(relay.url, 'OPTIONS', '/relay/api/v1/machine', { origin: 'http://evil.example' });
    expect(bad.status).toBe(403);
  });

  it('honours custom --allow-origin values', async () => {
    const r = await request(emptyRelay.url, 'GET', '/relay/health', { origin: 'http://localhost:9999' });
    expect(r.status).toBe(200);
    const d = await request(emptyRelay.url, 'GET', '/relay/health', { origin: 'http://localhost:8081' });
    expect(d.status).toBe(403);
  });
});

describe('target validation', () => {
  const ok = [
    'http://127.0.0.1:3088', 'http://localhost:3088', 'http://[::1]:3088', 'https://pc.tailnet.ts.net',
    'http://100.64.0.1:3089', 'https://100.127.255.254:3089', 'http://10.1.2.3:3088',
    'http://172.16.0.1:3088', 'http://172.31.9.9:3088', 'http://192.168.1.20:3088',
  ];
  const bad = [
    'http://example.com', 'https://example.com', 'http://pc.tailnet.ts.net', 'https://pc.tailnet.ts.net:8443',
    'https://ts.net', 'http://100.63.0.1', 'http://100.128.0.1', 'http://172.32.0.1', 'http://172.15.0.1',
    'http://11.0.0.1', 'http://8.8.8.8', 'ftp://127.0.0.1', 'http://user:pw@127.0.0.1:3088',
    'http://127.0.0.1:3088/api', 'http://127.0.0.1:3088/?x=1', 'http://evilts.net', 'http://127.0.0.1.evil.com',
    'not a url', '',
  ];
  it.each(ok)('accepts %s', (t) => { expect(parseTarget(t)).not.toBeNull(); });
  it.each(bad)('rejects %s', (t) => { expect(parseTarget(t)).toBeNull(); });

  it('answers 400 codes over HTTP', async () => {
    const missing = await request(relay.url, 'GET', '/relay/api/v1/machine');
    expect(missing.status).toBe(400);
    expect(JSON.parse(missing.body).code).toBe('relay_target_missing');
    const invalid = await request(relay.url, 'GET', '/relay/api/v1/machine', { 'x-studio-target': 'http://example.com' });
    expect(invalid.status).toBe(400);
    expect(JSON.parse(invalid.body).code).toBe('relay_target_invalid');
    expect(seen.length).toBe(0);
  });
});

describe('proxy', () => {
  it('forwards allowed headers, strips others, keeps path and query', async () => {
    seen = [];
    const r = await request(relay.url, 'POST', '/relay/api/v1/runs?limit=3&x=a%20b', {
      origin: 'http://localhost:8081',
      referer: 'http://localhost:8081/page',
      cookie: 'session=1',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'x-studio-target': upstreamUrl,
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
      accept: 'application/json',
      'last-event-id': '7',
      'x-custom': 'nope',
    }, '{"k":1}');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ hello: 'studio' });
    expect(seen).toHaveLength(1);
    const s = seen[0];
    expect(s.method).toBe('POST');
    expect(s.url).toBe('/api/v1/runs?limit=3&x=a%20b');
    expect(s.body).toBe('{"k":1}');
    expect(s.headers.authorization).toBe('Bearer test-token');
    expect(s.headers['content-type']).toBe('application/json');
    expect(s.headers['last-event-id']).toBe('7');
    expect(s.headers.host).toBe(new URL(upstreamUrl).host);
    for (const h of ['origin', 'referer', 'cookie', 'sec-fetch-mode', 'sec-fetch-site', 'x-studio-target', 'x-custom']) {
      expect(s.headers[h]).toBeUndefined();
    }
    // Response: allowlist only, upstream CORS and cookies dropped, relay CORS added.
    expect(r.headers.etag).toBe('"v1"');
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(r.headers['x-secret']).toBeUndefined();
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:8081');
  });

  it('supports GET and HEAD, refuses other methods', async () => {
    seen = [];
    const g = await request(relay.url, 'GET', '/relay/api/v1/machine', { 'x-studio-target': upstreamUrl });
    expect(g.status).toBe(200);
    const h = await request(relay.url, 'HEAD', '/relay/api/v1/machine', { 'x-studio-target': upstreamUrl });
    expect(h.status).toBe(200);
    expect(seen.map((s) => s.method)).toEqual(['GET', 'HEAD']);
    const d = await request(relay.url, 'DELETE', '/relay/api/v1/runs/1', { 'x-studio-target': upstreamUrl });
    expect(d.status).toBe(405);
    expect(seen).toHaveLength(2);
  });

  it('does not let dot segments leave /api/v1', async () => {
    seen = [];
    const r = await request(relay.url, 'GET', '/relay/api/v1/%2e%2e/%2e%2e/secret', { 'x-studio-target': upstreamUrl });
    expect(r.status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it('streams SSE chunks before the stream ends', async () => {
    seen = [];
    const u = new URL(relay.url);
    const t0 = Date.now();
    const firstChunkAt = await new Promise<number>((resolve, reject) => {
      const req = http.request({
        hostname: u.hostname, port: u.port, path: '/relay/api/v1/stream',
        headers: { 'x-studio-target': upstreamUrl, accept: 'text/event-stream' },
      }, (res) => {
        expect(res.headers['content-type']).toBe('text/event-stream');
        expect(res.headers['content-length']).toBeUndefined();
        res.once('data', (c) => {
          expect(c.toString()).toContain('id: 1');
          resolve(Date.now() - t0);
          req.destroy();
        });
      });
      req.on('error', () => {});
      req.setTimeout(5000, () => reject(new Error('no chunk')));
      req.end();
    });
    expect(firstChunkAt).toBeLessThan(1000);
  });

  it('closes the upstream request when the client aborts', async () => {
    const u = new URL(relay.url);
    sseClosed = false;
    const req = http.request({
      hostname: u.hostname, port: u.port, path: '/relay/api/v1/stream',
      headers: { 'x-studio-target': upstreamUrl },
    }, (res) => { res.once('data', () => req.destroy()); });
    req.on('error', () => {});
    req.end();
    for (let i = 0; i < 40 && !sseClosed; i++) await sleep(50);
    expect(sseClosed).toBe(true);
  });

  it('answers 502 relay_unreachable on a closed port', async () => {
    const port = await freePort();
    const r = await request(relay.url, 'GET', '/relay/api/v1/machine', {
      'x-studio-target': `http://127.0.0.1:${port}`, authorization: 'Bearer secret-token',
    });
    expect(r.status).toBe(502);
    const body = JSON.parse(r.body);
    expect(body.code).toBe('relay_unreachable');
    expect(r.body).not.toContain('secret-token');
    expect(r.body).not.toContain('ECONNREFUSED');
  });

  it('answers 502 when the upstream sends no headers in time', async () => {
    const silent = net.createServer(() => {}).listen(0, '127.0.0.1');
    await new Promise((r) => silent.once('listening', r));
    const port = (silent.address() as net.AddressInfo).port;
    const r = await request(staticRelay.url, 'GET', '/relay/api/v1/machine', { 'x-studio-target': `http://127.0.0.1:${port}` });
    expect(r.status).toBe(502);
    expect(JSON.parse(r.body).code).toBe('relay_unreachable');
    silent.close();
  });
});

describe('static files', () => {
  it('explains how to build when dist is missing', async () => {
    const r = await request(relay.url, 'GET', '/', { accept: 'text/html' });
    expect(r.status).toBe(200);
    expect(r.body).toContain('npm run build:web');
  });

  it('serves files with MIME types and cache headers', async () => {
    const idx = await request(staticRelay.url, 'GET', '/', { accept: 'text/html' });
    expect(idx.status).toBe(200);
    expect(idx.headers['content-type']).toContain('text/html');
    expect(idx.headers['cache-control']).toBe('no-cache');
    const js = await request(staticRelay.url, 'GET', '/_expo/static/js/app-1.js');
    expect(js.headers['content-type']).toContain('text/javascript');
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(js.body).toBe('console.log(1)');
    const ico = await request(staticRelay.url, 'GET', '/favicon.ico');
    expect(ico.headers['content-type']).toBe('image/x-icon');
    const font = await request(staticRelay.url, 'GET', '/font.woff2');
    expect(font.headers['content-type']).toBe('font/woff2');
    const head = await request(staticRelay.url, 'HEAD', '/favicon.ico');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  it('falls back to index.html for unknown HTML routes only', async () => {
    const spa = await request(staticRelay.url, 'GET', '/machines/abc', { accept: 'text/html,application/xhtml+xml' });
    expect(spa.status).toBe(200);
    expect(spa.body).toContain('<title>app</title>');
    const asset = await request(staticRelay.url, 'GET', '/missing.js', { accept: '*/*' });
    expect(asset.status).toBe(404);
  });

  it('does not allow directory traversal', async () => {
    for (const p of ['/../pf-secret.txt', '/%2e%2e/pf-secret.txt', '/..%2fpf-secret.txt', '/%2e%2e%2f%2e%2e%2fpf-secret.txt', '/a%00b']) {
      const r = await request(staticRelay.url, 'GET', p, { accept: '*/*' });
      expect(r.body).not.toContain('secret');
    }
    // raw dot segments, sent without client-side normalisation
    const raw = await request(staticRelay.url, 'GET', '/_expo/../../pf-secret.txt', { accept: '*/*' });
    expect(raw.body).not.toContain('secret');
  });
});
