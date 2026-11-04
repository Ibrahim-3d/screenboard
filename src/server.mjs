// The board server. Local only (127.0.0.1). Everything under PREFIX is the tool; every other path is the app:
//   proxied to the dev server (HTTP + websocket/HMR), or served from disk for a plain-HTML site.
// Same origin for board, app and mockups, so the board can measure frames and the pin layer can run inside them.
//   PREFIX/                 the canvas            PREFIX/comments.js   pin layer (also injected into every HTML page)
//   PREFIX/api/config       board config + frames GET|POST PREFIX/api/comments   pins (see store.mjs)
//   PREFIX/files/<path>     mockup files, only inside registered mockup folders
//   POST PREFIX/api/render  { ids, full } -> one JPG, or a zip of several (also kept in <data dir>/renders)
//   PREFIX/shots/<code>.png box snapshots (and <code>-ctx.png), from <data dir>/shots only
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREFIX, SHOT_PREFIX } from './name.mjs';
import * as store from './store.mjs';
import { buildFrames, mockupDirs, publicConfig, DEFAULTS } from './config.mjs';
import { renderToDir, zip } from './render.mjs';

const UI = fileURLToPath(new URL('../ui/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const TAG = `<script defer src="${PREFIX}/comments.js"></script>`;
const MAX_BODY = 30 * 1024 * 1024; // two PNGs of up to 10 MB each, base64

/** Put the pin layer into an HTML page, right after <head> (React 19 hydration skips unknown head tags). */
export function inject(html) {
  if (html.includes(TAG)) return html;
  const m = html.match(/<head(\s[^>]*)?>/i);
  return m ? html.replace(m[0], m[0] + TAG) : TAG + html;
}
const inside = (file, dir) => file === dir || file.startsWith(dir + path.sep);
const localHost = (h) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h || '');

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function serveFile(res, file, method, raw) {
  let f = file;
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch { return send(res, 404, 'not found', 'text/plain'); }
  fs.readFile(f, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    const type = TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream';
    send(res, 200, method === 'HEAD' ? '' : type.startsWith('text/html') && !raw ? inject(buf.toString('utf8')) : buf, type);
  });
}
const down = (target, start) => `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;color:#666;background:#f4f4f4"><div style="text-align:center">Dev server not running on :${target.port}${start ? `<br><br><code style="color:#222">${start.replace(/</g, '&lt;')}</code>` : ''}</div>`;

/**
 * @param {{ root: string, cfg: object, commentsFile: string }} o
 * @returns {http.Server} not yet listening
 */
export function createBoard({ root, cfg, commentsFile }) {
  const target = cfg.app?.url ? new URL(cfg.app.url) : null;
  const staticApp = !target && cfg.app?.framework === 'static';
  const authors = cfg.authors || DEFAULTS.authors;
  const dirs = mockupDirs(root, cfg);
  const shotsDir = path.join(path.dirname(commentsFile), 'shots');
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');

  let rendering = false;
  function exportFrames(req, res) {
    if (req.method !== 'POST' || !String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'POST application/json' });
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'cross-origin request refused' });
    if (rendering) return send(res, 409, { error: 'an export is already running' });
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (body += c).length > 1e6 && req.destroy());
    req.on('end', async () => {
      rendering = true;
      try {
        const { ids, full = true } = JSON.parse(body);
        const frames = (await buildFrames(root, cfg)).filter((f) => ids.includes(f.id));
        if (!frames.length) return send(res, 400, { error: 'no such frames' });
        const { rows, outDir } = await renderToDir({ root, board: `http://localhost:${server.address().port}`, frames, full: full !== false });
        const ok = rows.filter((r) => r.file);
        if (!ok.length) return send(res, 500, { error: rows[0].error });
        const one = frames.length === 1;
        const read = (r) => fs.readFileSync(path.join(outDir, r.file));
        const name = one ? ok[0].file : `${(cfg.title || 'board').replace(/[^\w.-]+/g, '-')}-frames.zip`;
        res.writeHead(200, { 'content-type': one ? 'image/jpeg' : 'application/zip', 'content-disposition': `attachment; filename="${name}"`, 'x-failed': String(rows.length - ok.length), 'cache-control': 'no-store' });
        res.end(one ? read(ok[0]) : zip(ok.map((r) => ({ name: r.file, data: read(r) }))));
      } catch (e) {
        send(res, 500, { error: e.message });
      } finally {
        rendering = false;
      }
    });
  }

  function api(req, res, p) {
    if (p === '/api/render') return exportFrames(req, res);
    if (p === '/api/config') {
      return buildFrames(root, cfg).then((frames) => send(res, 200, publicConfig(root, cfg, frames)), (e) => send(res, 500, { error: e.message }));
    }
    if (p !== '/api/comments') return send(res, 404, { error: 'unknown api' });
    if (req.method === 'GET') {
      try { return send(res, 200, store.read(commentsFile)); } catch (e) { return send(res, 500, { error: e.message }); }
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST' });
    // JSON only and same origin: a page on another site cannot write pins (text/plain posts skip CORS preflight).
    if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'content-type must be application/json' });
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'cross-origin write refused' });
    let body = '';
    let over = false;
    req.setEncoding('utf8');
    req.on('data', (c) => { if ((body += c).length > MAX_BODY) { over = true; body = ''; } });
    req.on('end', () => {
      if (over) return send(res, 413, { error: `request over ${MAX_BODY / 1048576} MB` });
      let list;
      try { list = store.read(commentsFile); } catch (e) { return send(res, 500, { error: `comments file unreadable, not overwritten: ${e.message}` }); }
      let files = [];
      let gone = null;
      try {
        const msg = JSON.parse(body);
        if (msg.delete) {
          gone = list.find((x) => x.id === msg.delete);
          list = store.remove(list, msg.delete);
        } else if (msg.shot) {
          // a snapshot only comes with a new pin; the server picks the code and the file names
          if (msg.pin?.id) throw new Error('a snapshot can only be added with a new pin');
          const s = msg.shot;
          const pngs = [store.png(s.png, 'shot.png'), store.png(s.ctx, 'shot.ctx')];
          const b = store.box(s.box);
          if (!['display-capture', 'dom'].includes(s.method)) throw new Error('shot.method must be display-capture or dom');
          list = store.upsert(list, msg.pin, authors);
          const code = store.nextCode(list, shotsDir, SHOT_PREFIX);
          const f = store.shotFiles(shotsDir, code);
          files = [[f.file, pngs[0]], [f.ctxFile, pngs[1]]];
          list = store.attachShot(list, list.at(-1).id, { code, file: rel(f.file), ctxFile: rel(f.ctxFile), box: b, method: s.method });
        } else list = store.upsert(list, msg.pin, authors);
      } catch (e) { return send(res, 400, { error: e.message }); }
      if (files.length) fs.mkdirSync(shotsDir, { recursive: true });
      files.forEach(([f, buf]) => fs.writeFileSync(f, buf));
      store.write(commentsFile, list);
      if (gone?.shot) {
        // deleting a pin deletes its snapshot files (by validated code, never by a stored path)
        try { Object.values(store.shotFiles(shotsDir, gone.shot.code)).forEach((f) => fs.rmSync(f, { force: true })); } catch { /* bad code: nothing to delete */ }
      }
      send(res, 200, list);
    });
  }

  function proxy(req, res) {
    const headers = { ...req.headers, host: target.host };
    if (headers.origin) headers.origin = target.origin;
    if (headers.referer) headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, target.origin);
    const dest = req.headers['sec-fetch-dest'];
    const page = dest === 'document' || dest === 'iframe' || (!dest && /text\/html/.test(req.headers.accept || ''));
    if (page) delete headers['accept-encoding']; // plain text back, so the pin layer can be injected
    const up = http.request({ host: target.hostname, port: target.port || 80, path: req.url, method: req.method, headers }, (r) => {
      const h = { ...r.headers };
      delete h['x-frame-options'];
      if (h['content-security-policy']) h['content-security-policy'] = String(h['content-security-policy']).replace(/frame-ancestors[^;]*;?/i, '');
      if (h.location?.startsWith(target.origin)) h.location = h.location.slice(target.origin.length) || '/';
      if (!page || !String(h['content-type']).includes('text/html') || h['content-encoding']) {
        res.writeHead(r.statusCode ?? 502, h);
        return r.pipe(res);
      }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const out = Buffer.from(inject(Buffer.concat(chunks).toString('utf8')), 'utf8');
        delete h['transfer-encoding'];
        h['content-length'] = out.length;
        res.writeHead(r.statusCode ?? 200, h);
        res.end(out);
      });
    });
    up.on('error', () => send(res, 502, down(target, cfg.app.start), 'text/html; charset=utf-8'));
    req.pipe(up);
  }

  const server = http.createServer((req, res) => {
    if (!localHost(req.headers.host)) return send(res, 403, 'forbidden host', 'text/plain'); // DNS-rebinding guard
    const url = new URL(req.url, 'http://localhost');
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'bad path', 'text/plain'); }
    if (p === PREFIX) return res.writeHead(302, { location: PREFIX + '/' }).end();
    if (p.startsWith(PREFIX + '/')) {
      const rest = p.slice(PREFIX.length);
      if (rest === '/') return serveFile(res, path.join(UI, 'board.html'), req.method, true);
      if (rest === '/comments.js') return serveFile(res, path.join(UI, 'comments.js'), req.method, true);
      if (rest.startsWith('/api/')) return api(req, res, rest);
      if (rest.startsWith('/shots/')) {
        const m = rest.slice(7).match(/^([A-Z]{1,8}-\d{4,8})(-ctx)?\.png$/);
        if (!m) return send(res, 404, 'not found', 'text/plain');
        const f = store.shotFiles(shotsDir, m[1]);
        return serveFile(res, m[2] ? f.ctxFile : f.file, req.method);
      }
      if (rest.startsWith('/files/')) {
        const file = path.resolve(root, '.' + path.posix.normalize('/' + rest.slice(7)));
        if (!dirs.some((d) => inside(file, d))) return send(res, 403, 'not a registered mockup folder', 'text/plain');
        return serveFile(res, file, req.method);
      }
      return send(res, 404, 'not found', 'text/plain');
    }
    if (target) return proxy(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain');
    if (staticApp) {
      const file = path.resolve(root, '.' + path.posix.normalize('/' + p));
      if (!inside(file, root) || path.relative(root, file).split(path.sep).some((s) => s.startsWith('.'))) return send(res, 403, 'forbidden', 'text/plain');
      return serveFile(res, file, req.method);
    }
    if (p === '/') return res.writeHead(302, { location: PREFIX + '/' }).end();
    send(res, 404, 'not found', 'text/plain');
  });

  // HMR / any websocket: replay the upgrade request to the dev server and splice the sockets.
  server.on('upgrade', (req, socket, head) => {
    if (!target || !localHost(req.headers.host) || req.url.startsWith(PREFIX)) return socket.destroy();
    const up = net.connect(Number(target.port) || 80, target.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const [k, v] = [req.rawHeaders[i], req.rawHeaders[i + 1]];
        const low = k.toLowerCase();
        lines.push(`${k}: ${low === 'host' ? target.host : low === 'origin' ? target.origin : v}`);
      }
      up.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length) up.write(head);
      up.pipe(socket).pipe(up);
    });
    const end = () => { socket.destroy(); up.destroy(); };
    up.on('error', end);
    socket.on('error', end);
  });
  return server;
}

/** Listen on the first free port from `port` (up to +20 unless strict). Resolves to the bound port. */
export function listen(server, port, strict) {
  return new Promise((resolve, reject) => {
    let p = port;
    const tryPort = () => server.listen(p, '127.0.0.1');
    server.on('listening', () => resolve(server.address().port));
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE' && !strict && p !== 0 && p < port + 20) { p++; tryPort(); } else reject(e);
    });
    tryPort();
  });
}
