// Comment pins: one JSON array on disk, UTF-8, pretty-printed, safe to read and edit by hand.
//   { id: "p1", screen, frame, selector, hint, x, y, text, author, status: "open" | "resolved", createdAt, thread: [{ author, text, createdAt }] }
//   screen = page path + hash; frame = board frame id; selector is relative to the anchor root; x, y = % inside that element;
//   hint = the element's tag and text when the pin was dropped (for finding it in source).
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
const ORDER = ['id', 'screen', 'frame', 'selector', 'hint', 'x', 'y', 'text', 'author', 'status', 'createdAt', 'thread'];

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
