// Self-check: boots a board against a throwaway fake dev server and mockup folder, then exercises every route.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { NAME, PREFIX, DATA_DIR } from './name.mjs';
import { createBoard, listen } from './server.mjs';

const req = (port, p, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ s: res.statusCode, h: res.headers, b }));
    });
    r.on('error', reject);
    r.end(body);
  });

export async function selfCheck() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${NAME}-check-`));
  fs.mkdirSync(path.join(tmp, 'mockups'));
  fs.writeFileSync(path.join(tmp, 'mockups/a.html'), '<!doctype html><html><head><title>A</title></head><body><a href="b.html">b</a></body></html>');
  fs.writeFileSync(path.join(tmp, 'mockups/b.html'), '<!doctype html><html><head></head><body>B</body></html>');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'secret');

  // Fake dev server: HTML pages, a script, a redirect to its own origin, and a websocket that echoes the Host it saw.
  let appPort;
  const app = http.createServer((q, s) => {
    if (q.url === '/go') return s.writeHead(302, { location: `http://localhost:${appPort}/about` }).end();
    const js = q.url === '/x.js';
    s.writeHead(200, { 'content-type': js ? 'text/javascript' : 'text/html; charset=utf-8', 'x-frame-options': 'DENY' });
    s.end(js ? 'ok()' : `<!doctype html><html><head><title>t</title></head><body><h1>${q.url}</h1></body></html>`);
  });
  app.on('upgrade', (q, sock) => sock.end(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nhost=${q.headers.host}`));
  appPort = await listen(app, 0);

  const file = path.join(tmp, DATA_DIR, 'comments.json');
  const cfg = { title: 'check', authors: ['human', 'agent'], app: { framework: 'next', url: `http://localhost:${appPort}`, routes: ['/', '/about'] }, mockups: [{ path: 'mockups' }] };
  const board = createBoard({ root: tmp, cfg, commentsFile: file });
  const port = await listen(board, 0);
  const deadBoard = createBoard({ root: tmp, cfg: { ...cfg, app: { ...cfg.app, url: 'http://localhost:9', start: 'pnpm dev' } }, commentsFile: file });
  const deadPort = await listen(deadBoard, 0);

  const results = [];
  const ok = (c, m) => results.push((c ? 'ok   ' : 'FAIL ') + m);
  const json = { 'content-type': 'application/json' };
  const post = async (b, headers = json) => { const r = await req(port, PREFIX + '/api/comments', { method: 'POST', headers, body: JSON.stringify(b) }); return { s: r.s, j: JSON.parse(r.b) }; };
  const tag = `${PREFIX}/comments.js`;
  try {
    ok((await req(port, PREFIX + '/')).s === 200, 'board page');
    ok((await req(port, PREFIX + '/comments.js')).s === 200, 'pin layer script');
    const c = JSON.parse((await req(port, PREFIX + '/api/config')).b);
    ok(c.frames.length === 6 && c.frames.filter((f) => f.space === 'Mockups').length === 2, 'config: 2 routes x 2 devices + 2 mockups');
    const page = await req(port, '/about', { headers: { 'sec-fetch-dest': 'iframe', accept: 'text/html' } });
    ok(page.s === 200 && page.b.includes('<h1>/about</h1>') && page.b.includes(tag), 'proxied page + pin layer injected');
    ok(!page.h['x-frame-options'], 'x-frame-options stripped');
    const js = await req(port, '/x.js', { headers: { 'sec-fetch-dest': 'script' } });
    ok(js.b === 'ok()', 'assets pass through untouched');
    ok((await req(port, '/go')).h.location === '/about', 'redirect kept on the board origin');
    const mock = await req(port, PREFIX + '/files/mockups/a.html');
    ok(mock.s === 200 && mock.b.includes(tag), 'mockup served + pin layer injected');
    ok((await req(port, PREFIX + '/files/secret.txt')).s === 403, 'file outside mockup folders refused');
    ok((await req(port, PREFIX + '/files/mockups/..%2f..%2fsecret.txt')).s === 403, 'path traversal refused');
    ok((await req(port, PREFIX + '/', { headers: { host: 'evil.example' } })).s === 403, 'foreign Host refused');
    const dead = await req(deadPort, '/', { headers: { 'sec-fetch-dest': 'iframe' } });
    ok(dead.s === 502 && dead.b.includes('pnpm dev'), 'dev server down: 502 with the start command');
    const ws = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => s.write(`GET /hmr HTTP/1.1\r\nHost: localhost:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`));
      let b = '';
      s.on('data', (d) => (b += d));
      s.on('close', () => resolve(b));
      s.on('error', () => resolve(b));
    });
    ok(ws.startsWith('HTTP/1.1 101') && ws.includes(`host=localhost:${appPort}`), 'websocket (HMR) spliced, Host rewritten');

    ok((await post({ pin: { screen: '/', selector: 'b', x: 1, y: 1, text: 'x', author: 'human' } }, { 'content-type': 'text/plain' })).s === 415, 'non-JSON write refused');
    ok((await post({ pin: { screen: '/', selector: 'b', x: 1, y: 1, text: 'x', author: 'human' } }, { ...json, origin: 'http://evil.example' })).s === 403, 'cross-origin write refused');
    const c1 = await post({ pin: { screen: '/about', frame: 'desktop:/about', selector: ':scope > h1:nth-of-type(1)', hint: '<h1> /about', x: 120, y: 5, text: 'hi', author: 'human' } });
    ok(c1.s === 200 && c1.j[0].id === 'p1' && c1.j[0].x === 100, 'pin created, offset clamped');
    ok(fs.readFileSync(file, 'utf8').includes('\n  {\n    "id": "p1"'), 'comments.json pretty-printed');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"thread": []', '"thread": [{"author":"agent","text":"reply","createdAt":"2000-01-01T00:00:00.000Z"}]'));
    const c2 = await post({ pin: { id: 'p1', status: 'resolved', thread: [{ author: 'human', text: 'mine', createdAt: '2001-01-01T00:00:00.000Z' }] } });
    ok(c2.j[0].thread.length === 2 && c2.j[0].status === 'resolved', 'merge keeps a hand-written reply');
    ok((await post({ pin: { screen: '/', selector: 'b', x: 1, y: 1, text: 'x', author: 'nobody' } })).s === 400, 'unknown author refused');
    fs.writeFileSync(file, '[ broken');
    ok((await post({ pin: { screen: '/', selector: 'b', x: 1, y: 1, text: 'x', author: 'human' } })).s === 500 && fs.readFileSync(file, 'utf8') === '[ broken', 'unreadable file never overwritten');
    fs.writeFileSync(file, JSON.stringify(c2.j));
    ok((await post({ delete: 'p1' })).j.length === 0, 'pin deleted');
  } catch (e) {
    ok(false, 'unexpected error: ' + e.message);
  } finally {
    board.close();
    deadBoard.close();
    app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return results;
}
