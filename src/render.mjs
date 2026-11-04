// render: every board frame to a JPG (quality 80: a fraction of a PNG's size, plenty for review) in one run, plus a manifest an agent can read instead of re-shooting by hand.
// Drives the installed Chrome/Edge headless over the DevTools protocol (Node's built-in WebSocket, no dependency).
// Each frame opens the board in solo mode (?solo=<frame id>), so a shot uses the same proxy, device width and
// full-length logic as the canvas. Frames run in parallel tabs.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { NAME, PREFIX, DATA_DIR } from './name.mjs';

const MAX_H = 16000; // Chrome cannot capture much past 16384 px in one image
const JOBS = 4;

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const e = process.env;
  const win = [e.PROGRAMFILES, e['PROGRAMFILES(X86)'], e.LOCALAPPDATA].filter(Boolean).flatMap((d) => [path.join(d, 'Google/Chrome/Application/chrome.exe'), path.join(d, 'Microsoft/Edge/Application/msedge.exe')]);
  const mac = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  const hit = (process.platform === 'win32' ? win : process.platform === 'darwin' ? mac : []).find((f) => fs.existsSync(f));
  if (hit) return hit;
  for (const b of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'])
    try { return execFileSync('which', [b], { encoding: 'utf8' }).trim(); } catch { /* next */ }
  return null;
}

async function launch(exe) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${NAME}-chrome-`));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const ws = await new Promise((resolve, reject) => {
    let err = '';
    const t = setTimeout(() => reject(new Error(`browser did not start: ${err.slice(-300)}`)), 20000);
    proc.stderr.on('data', (c) => {
      const m = (err += c).match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) (clearTimeout(t), resolve(m[1]));
    });
    proc.on('exit', (code) => reject(new Error(`browser exited (${code}): ${err.slice(-300)}`)));
  });
  const close = () => { proc.kill(); setTimeout(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }), 500); };
  return { ws, close };
}

/** Minimal DevTools client: one socket, flat sessions. */
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('DevTools socket failed')); });
  let n = 0;
  const wait = new Map();
  const subs = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) {
      const w = wait.get(m.id);
      wait.delete(m.id);
      m.error ? w.rej(new Error(m.error.message)) : w.res(m.result);
    } else subs.forEach((f) => f(m));
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++n; wait.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  return { send, on: (f) => subs.add(f), off: (f) => subs.delete(f), close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fileOf = (f) => `${(f.device || 'mockup').toLowerCase()}_${f.pair.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}.jpg`;

/** One frame in one tab: open solo, wait for the network to go quiet, measure, capture. */
async function shoot(c, sid, board, f, { full, outDir, settle }) {
  let inflight = 0;
  let last = Date.now();
  const net = (m) => {
    if (m.sessionId !== sid) return;
    if (m.method === 'Network.requestWillBeSent') (inflight++, (last = Date.now()));
    if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') (inflight = Math.max(0, inflight - 1), (last = Date.now()));
  };
  c.on(net);
  try {
    await c.send('Emulation.setDeviceMetricsOverride', { width: f.width, height: f.height, deviceScaleFactor: 1, mobile: false }, sid);
    await c.send('Page.navigate', { url: `${board}${PREFIX}/?solo=${encodeURIComponent(f.id)}${full ? '' : '&full=0'}` }, sid);
    const ev = (expression) => c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid).then((r) => { if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; });
    await ev(`new Promise((r, j) => { let n = 0; const t = () => window.BOARD?.solo ? window.BOARD.solo.then(r, j) : n++ > 300 ? j(new Error('board did not load')) : setTimeout(t, 50); t(); })`);
    const end = Date.now() + settle;
    while (Date.now() < end && (inflight > 0 || Date.now() - last < 500)) await sleep(100); // quiet for 500 ms, or give up at `settle`
    await ev(`document.querySelector('iframe').contentDocument.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`);
    const size = await ev('window.BOARD.measure()');
    const height = Math.min(size.height, MAX_H);
    await c.send('Emulation.setDeviceMetricsOverride', { width: f.width, height, deviceScaleFactor: 1, mobile: false }, sid);
    await sleep(150);
    const { data } = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 80, clip: { x: 0, y: 0, width: f.width, height, scale: 1 } }, sid);
    const file = fileOf(f);
    fs.writeFileSync(path.join(outDir, file), Buffer.from(data, 'base64'));
    return { file, height, cut: size.height > MAX_H || undefined };
  } finally {
    c.off(net);
  }
}

/**
 * @param {{ board: string, frames: object[], outDir: string, full?: boolean, settle?: number, log?: (s: string) => void }} o
 * @returns {Promise<object[]>} one row per frame: frame fields + file + height, or error
 */
export async function render({ board, frames, outDir, full = true, settle = 8000, log = () => {} }) {
  const exe = findChrome();
  if (!exe) throw new Error('no Chrome or Edge found; set CHROME_PATH');
  fs.mkdirSync(outDir, { recursive: true });
  const br = await launch(exe);
  const c = await connect(br.ws);
  const rows = [];
  try {
    const queue = [...frames];
    const worker = async () => {
      const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId: sid } = await c.send('Target.attachToTarget', { targetId, flatten: true });
      await Promise.all(['Page.enable', 'Network.enable', 'Runtime.enable'].map((m) => c.send(m, {}, sid)));
      for (let f; (f = queue.shift()); ) {
        const row = { id: f.id, space: f.space, device: f.device, label: f.label, url: f.url, source: f.source, width: f.width };
        try {
          Object.assign(row, await shoot(c, sid, board, f, { full, outDir, settle }));
          log(`ok   ${row.file}`);
        } catch (e) {
          row.error = e.message;
          log(`FAIL ${f.id}: ${e.message}`);
        }
        rows.push(row);
      }
      await c.send('Target.closeTarget', { targetId }).catch(() => {});
    };
    await Promise.all(Array.from({ length: Math.min(JOBS, frames.length) }, worker));
  } finally {
    c.close();
    br.close();
  }
  return frames.map((f) => rows.find((r) => r.id === f.id));
}

/** Render into <root>/<data dir>/renders and merge manifest.json (a partial run keeps the other rows). */
export async function renderToDir({ root, frames, ...o }) {
  const outDir = path.join(root, DATA_DIR, 'renders');
  const rows = await render({ ...o, frames, outDir });
  const manifestFile = path.join(outDir, 'manifest.json');
  let old = [];
  try { old = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).frames || []; } catch { /* first run */ }
  const at = new Date().toISOString();
  const merged = [...old.filter((x) => !rows.some((r) => r.id === x.id)), ...rows.map((r) => ({ ...r, renderedAt: at }))];
  fs.writeFileSync(manifestFile, JSON.stringify({ dir: path.relative(root, outDir).split(path.sep).join('/'), frames: merged }, null, 2) + '\n', 'utf8');
  return { rows, outDir, manifestFile };
}

/** A store-only zip (JPGs do not compress further). entries: [{ name, data: Buffer }] */
export function zip(entries) {
  const parts = [];
  const central = [];
  let off = 0;
  for (const { name, data } of entries) {
    const n = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(33, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, n, data);
    central.push(c, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
