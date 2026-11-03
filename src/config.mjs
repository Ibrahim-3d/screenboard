// Config file (<repo>/screenboard.config.json) and the frames the board lays out from it.
//   title, port, authors [human, agent], rootSelector, anchorAttrs, columns { <section>: n, default: n }
//   app: { framework, url, start, routes?: [paths] (manual list wins), exclude?: [path prefixes], devices?: [{ name, width, height }] }
//   mockups: [{ path: "docs/mockups" | "docs/x.html#screen", label?, width?, height? }]
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, PREFIX } from './name.mjs';
import { routes, walk } from './detect.mjs';

export const DEVICES = [
  { name: 'Desktop', width: 1440, height: 900 },
  { name: 'Phone', width: 390, height: 844 },
];
export const DEFAULTS = { authors: ['human', 'agent'], rootSelector: 'body', anchorAttrs: ['id', 'data-testid'] };

/** The repo root: the nearest folder (upwards) holding the config file, else cwd. */
export function findRoot(cwd = process.cwd()) {
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, CONFIG_FILE))) return d;
    if (path.dirname(d) === d) return path.resolve(cwd);
  }
}
export function loadConfig(root) {
  const f = path.join(root, CONFIG_FILE);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}
export function saveConfig(root, cfg) {
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

const split = (p) => { const i = p.search(/[?#]/); return i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i)]; };

/** Files of one mockup entry: a single .html (optionally with ?query/#hash) or every .html in a folder. */
export function mockupFiles(root, entry) {
  const [p, suffix] = split(entry.path);
  const abs = path.resolve(root, p);
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return walk(abs).filter((f) => f.endsWith('.html')).sort().map((f) => ({ rel: path.posix.join(p, f), name: f, suffix: '' }));
  return fs.existsSync(abs) ? [{ rel: p, name: path.posix.basename(p), suffix, single: true }] : [];
}
/** Folders the board may serve mockup files from: each entry's folder (a single file exposes its siblings: css, images). */
export function mockupDirs(root, cfg) {
  return (cfg.mockups || []).map((m) => {
    const abs = path.resolve(root, split(m.path)[0]);
    return fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  });
}

const section = (p) => {
  const s = p.replace(/^\/#/, '').split('/').filter(Boolean);
  return s.length < 2 ? 'Pages' : s[0][0].toUpperCase() + s[0].slice(1);
};

/** Frames: App = every route × device (live, proxied); Mockups = every mockup file (served from disk). */
export async function buildFrames(root, cfg, { live = true } = {}) {
  const frames = [];
  const app = cfg.app;
  if (app?.framework) {
    const r = await routes(root, app.framework, { url: live ? app.url : null, manual: app.routes, exclude: app.exclude });
    for (const route of r.list)
      for (const d of app.devices || DEVICES)
        frames.push({ id: `${d.name.toLowerCase()}:${route.path}`, label: route.path, url: route.path, width: d.width, height: d.height, space: 'App', section: section(route.path), pair: route.path, device: d.name, source: route.file });
  }
  for (const m of cfg.mockups || [])
    for (const f of mockupFiles(root, m))
      frames.push({ id: `mock:${f.rel}${f.suffix}`, label: f.single && m.label ? m.label : f.name + f.suffix, url: `${PREFIX}/files/${encodeURI(f.rel)}${f.suffix}`, width: m.width || 1440, height: m.height || 900, space: 'Mockups', section: f.single ? path.posix.dirname(f.rel) : m.label || f.rel.slice(0, -f.name.length - 1), pair: f.rel + f.suffix, device: null, source: f.rel });
  return frames;
}

export function publicConfig(root, cfg, frames) {
  return {
    title: cfg.title || path.basename(root),
    authors: cfg.authors || DEFAULTS.authors,
    rootSelector: cfg.rootSelector || DEFAULTS.rootSelector,
    anchorAttrs: cfg.anchorAttrs || DEFAULTS.anchorAttrs,
    columns: cfg.columns || {},
    app: cfg.app ? { url: cfg.app.url || null, start: cfg.app.start || null } : null,
    frames,
  };
}
