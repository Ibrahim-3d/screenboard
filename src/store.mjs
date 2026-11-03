// Comment pins: one JSON array on disk, UTF-8, pretty-printed, safe to read and edit by hand.
//   { id: "p1", screen, frame, selector, hint, x, y, text, author, status: "open" | "resolved", createdAt, thread: [{ author, text, createdAt }] }
//   screen = page path + hash; frame = board frame id; selector is relative to the anchor root; x, y = % inside that element;
//   hint = the element's tag and text when the pin was dropped (for finding it in source).
//   shot (box pins only) = { code, file, ctxFile, box, method }: a PNG of the boxed area and one of the whole frame
//   with the box outlined. Written by the server only (see shotFiles); clients cannot set it.
// A file that does not parse is never overwritten.
import fs from 'node:fs';
import path from 'node:path';

export function read(file) {
  if (!fs.existsSync(file)) return [];
  const list = JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
  if (!Array.isArray(list)) throw new Error(`${file} must hold a JSON array`);
  return list;
}

export function write(file, list) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

const str = (v, max, name) => {
  if (typeof v !== 'string' || v.length > max) throw new Error(`${name} must be a string up to ${max} chars`);
  return v;
};
const pct = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a number`);
  return Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
};
const ORDER = ['id', 'screen', 'frame', 'selector', 'hint', 'x', 'y', 'shot', 'text', 'author', 'status', 'createdAt', 'thread'];

/** Validate an incoming pin and merge it over the stored one. Throws on bad input. */
export function upsert(list, p, authors) {
  const author = (v) => {
    if (!authors.includes(v)) throw new Error(`author must be one of ${authors.join(', ')}`);
    return v;
  };
  const entry = (t) => ({ author: author(t.author), text: str(t.text, 5000, 'thread text'), createdAt: str(t.createdAt || new Date().toISOString(), 40, 'createdAt') });
  if (!p || typeof p !== 'object') throw new Error('pin missing');
  const old = p.id ? list.find((x) => x.id === p.id) : null;
  if (p.id && !old) throw new Error(`no pin ${p.id}`);
  const next = 'p' + (Math.max(0, ...list.map((x) => parseInt(String(x.id).slice(1), 10) || 0)) + 1);
  const m = { ...(old || { id: next, createdAt: new Date().toISOString(), thread: [] }) };
  if (p.screen !== undefined || !old) m.screen = str(p.screen ?? '', 600, 'screen');
  if (p.frame !== undefined) m.frame = p.frame === null ? null : str(p.frame, 200, 'frame');
  if (p.selector !== undefined || !old) m.selector = str(p.selector ?? '', 3000, 'selector');
  if (p.hint !== undefined) m.hint = str(p.hint, 300, 'hint');
  if (p.x !== undefined || !old) m.x = pct(p.x, 'x');
  if (p.y !== undefined || !old) m.y = pct(p.y, 'y');
  if (p.text !== undefined || !old) m.text = str(p.text, 5000, 'text');
  if (!m.text.trim()) throw new Error('text is empty');
  if (p.author !== undefined || !old) m.author = author(p.author);
  if (p.status !== undefined || !old) {
    if (!['open', 'resolved'].includes(p.status ?? 'open')) throw new Error('status must be open or resolved');
    m.status = p.status ?? 'open';
  }
  if (p.thread !== undefined) {
    if (!Array.isArray(p.thread)) throw new Error('thread must be an array');
    const key = (t) => `${t.createdAt}|${t.author}|${t.text}`;
    const all = new Map((old ? old.thread : []).map((t) => [key(t), t]));
    p.thread.map(entry).forEach((t) => all.set(key(t), t));
    m.thread = [...all.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  const out = Object.fromEntries(ORDER.filter((k) => m[k] !== undefined).map((k) => [k, m[k]]));
  return old ? list.map((x) => (x.id === old.id ? out : x)) : [...list, out];
}

export const remove = (list, id) => list.filter((x) => x.id !== id);

// ---------- box snapshots ----------
const num = (v, name, min, max) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`${name} must be a number from ${min} to ${max}`);
  return Math.round(v * 10) / 10;
};
const MAX_PNG = 10 * 1024 * 1024;

/** Decode a PNG data URL and check it really is a PNG of sane size. Throws otherwise. */
export function png(dataUrl, name) {
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error(`${name} must be a PNG data URL`);
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_PNG) throw new Error(`${name} is over ${MAX_PNG / 1048576} MB`);
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a || buf.toString('latin1', 12, 16) !== 'IHDR') throw new Error(`${name} is not a PNG`);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (!w || !h || w > 16384 || h > 16384) throw new Error(`${name} has a bad size ${w}x${h}`);
  return buf;
}

/** Validate the box a client sends with a snapshot. Percentages are of the anchor element; px at capture time. */
export function box(b) {
  if (!b || typeof b !== 'object') throw new Error('box missing');
  const px = (o, n) => ({ x: num(o?.x, n + '.x', -1e5, 1e5), y: num(o?.y, n + '.y', -1e5, 1e5), w: num(o?.w, n + '.w', 0, 1e5), h: num(o?.h, n + '.h', 0, 1e5) });
  return {
    frame: b.frame == null ? null : str(b.frame, 200, 'box.frame'),
    selector: str(b.selector ?? '', 3000, 'box.selector'),
    x: pct(b.x, 'box.x'), y: pct(b.y, 'box.y'), w: pct(b.w, 'box.w'), h: pct(b.h, 'box.h'),
    px: px(b.px, 'box.px'),
    dpr: num(b.dpr, 'box.dpr', 0.1, 8),
    viewport: { w: num(b.viewport?.w, 'box.viewport.w', 1, 1e5), h: num(b.viewport?.h, 'box.viewport.h', 1, 1e5) },
  };
}

/** Next free code: one above every code used by a pin or present as a file. */
export function nextCode(list, dir, prefix) {
  const re = new RegExp(`^${prefix}-(\\d+)`);
  const used = [...list.map((p) => p.shot?.code || ''), ...(fs.existsSync(dir) ? fs.readdirSync(dir) : [])].map((s) => +(s.match(re)?.[1] || 0));
  return `${prefix}-${String(Math.max(0, ...used) + 1).padStart(4, '0')}`;
}

/** Absolute paths of a shot's two files, only ever inside dir (codes are validated, never taken as paths). */
export function shotFiles(dir, code) {
  if (!/^[A-Z]{1,8}-\d{4,8}$/.test(code || '')) throw new Error('bad shot code');
  return { file: path.join(dir, code + '.png'), ctxFile: path.join(dir, code + '-ctx.png') };
}

export function attachShot(list, id, shot) {
  return list.map((p) => (p.id === id ? Object.fromEntries(ORDER.filter((k) => (k === 'shot' ? shot : p[k]) !== undefined).map((k) => [k, k === 'shot' ? shot : p[k]])) : p));
}
