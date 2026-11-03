// Detection: framework, dev server URL and port, routes (with the source file behind each), mockup folders.
// Everything is a read-only scan of the repo plus optional HTTP probes; nothing is started or written.
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const json = (f) => { try { return JSON.parse(read(f)); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const posix = (p) => p.split(path.sep).join('/');
const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '_site', '_Archive', 'playwright-report', 'test-results', 'vendor']);

/** Every file under dir (relative, forward slashes), skipping dependency/build/dot folders. */
export function walk(dir, max = 20000) {
  const out = [];
  const go = (d) => {
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (out.length >= max) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && !SKIP.has(e.name)) go(p); }
      else out.push(posix(path.relative(dir, p)));
    }
  };
  go(dir);
  return out;
}

// ---------- route model: concrete routes { path, file } and dynamic patterns { pattern, file } ----------
const DYN = /\[.+?\]|^\$|^\(\$.+\)$/;
function add(out, segs, file) {
  const parts = segs.filter(Boolean).map((s) => (/^\[\[?\.\.\./.test(s) || s === '$' ? '**' : DYN.test(s) ? '*' : s));
  const p = '/' + parts.join('/');
  if (parts.some((s) => s === '*' || s === '**')) out.patterns.push({ pattern: p, file });
  else if (!out.routes.some((r) => r.path === p)) out.routes.push({ path: p, file });
}
const rx = (pattern) => new RegExp('^' + pattern.split('/').map((s) => (s === '**' ? '.+' : s === '*' ? '[^/]+' : s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('/') + '/?$');
const empty = () => ({ routes: [], patterns: [], notes: [] });

/** Directory routers: a folder is a route when it holds a page file (Next app router, SvelteKit). */
function dirRouter(root, base, pageFile) {
  const out = empty();
  for (const f of walk(path.join(root, base))) {
    const parts = f.split('/');
    if (!pageFile.test(parts.pop())) continue;
    if (parts.some((s) => s.startsWith('@') || s.startsWith('_') || /^\(\.+\)/.test(s))) continue; // parallel, private, intercepting
    add(out, parts.filter((s) => !/^\(.+\)$/.test(s)), `${base}/${f}`);
  }
  return out;
}

/** File routers: each file is a route, index = folder (Next pages router, Astro, Nuxt, vite-plugin-pages). */
function fileRouter(root, base, ext, skip = () => false) {
  const out = empty();
  for (const f of walk(path.join(root, base))) {
    if (!ext.test(f) || skip(f)) continue;
    const parts = f.replace(ext, '').split('/');
    if (parts.some((s) => s.startsWith('_'))) continue;
    if (parts.at(-1) === 'index') parts.pop();
    add(out, parts, `${base}/${f}`);
  }
  return out;
}

/** Dollar routers: dots are slashes, $x is dynamic, _x is pathless (Remix flat routes, TanStack file routes). */
function dollarRouter(root, base, nested) {
  const out = empty();
  for (const f of walk(path.join(root, base))) {
    if (!/\.(tsx|ts|jsx|js|mdx|md)$/.test(f) || /\.(server|client)\.\w+$/.test(f) || /(^|\/)-/.test(f) || /__root/.test(f)) continue;
    let parts = f.replace(/\.\w+$/, '').split(/[./]/);
    if (parts.at(-1) === 'route') parts.pop(); // folder route: about/route.tsx
    else if (!nested && f.includes('/') && !/^(index|_index)$/.test(parts.at(-1))) continue; // Remix: other files in route folders are modules
    parts = parts.filter((s) => s !== '_index' && s !== 'index' && !s.startsWith('_') && !/^\(.+\)$/.test(s)).map((s) => s.replace(/_$/, ''));
    add(out, parts, `${base}/${f}`);
  }
  return out;
}

/** Router declarations in source (react-router objects/JSX, React Router v7 routes.ts). */
function declared(root, files) {
  const out = empty();
  let relative = 0;
  let hash = false;
  for (const f of files) {
    const src = read(path.join(root, f)) || '';
    if (/createHashRouter|<HashRouter/.test(src)) hash = true;
    for (const m of src.matchAll(/(?:\bpath\s*[:=]\s*\{?\s*|\broute\(\s*)["'`]([^"'`]*)["'`]/g)) {
      let p = m[1];
      if (p === '*' || p.includes('*')) continue;
      if (!p.startsWith('/')) { if (p) relative++; p = '/' + p; }
      add(out, p.split('/').map((s) => (s.startsWith(':') ? '[x]' : s)), f);
    }
    if (/\bindex\(\s*["'`]/.test(src)) add(out, [], f);
  }
  if (relative) out.notes.push(`${relative} nested relative route path(s) taken as top level`);
  if (hash) out.routes.forEach((r) => (r.path = '/#' + r.path));
  out.relative = relative;
  return out;
}

/** Eleventy: templates under the input dir; permalink front matter wins; pagination is skipped. */
function eleventy(root) {
  const cfg = ['.eleventy.js', 'eleventy.config.js', 'eleventy.config.mjs', 'eleventy.config.cjs'].map((f) => read(path.join(root, f))).find(Boolean) || '';
  const input = (cfg.match(/input\s*:\s*["'`]([^"'`]+)/) || [])[1] || '.';
  const out = empty();
  for (const f of walk(path.join(root, input))) {
    if (!/\.(md|njk|html|liquid|hbs|pug|ejs|11ty\.js)$/.test(f) || f.split('/').some((s) => s.startsWith('_')) || /^(README|CHANGELOG|LICENSE)\.md$/i.test(f)) continue;
    const file = posix(path.join(input, f));
    const fm = ((read(path.join(root, file)) || '').match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
    if (/^pagination\s*:/m.test(fm)) { out.notes.push(`${file}: pagination skipped`); continue; }
    const perm = (fm.match(/^permalink\s*:\s*["']?([^"'\r\n]+)/m) || [])[1];
    if (perm === 'false' || perm?.includes('{')) continue;
    const x = f.replace(/\.11ty\.js$|\.\w+$/, '').replace(/(^|\/)index$/, '');
    const p = perm ? '/' + perm.replace(/^\/+/, '').replace(/index\.html$/, '') : x ? `/${x}/` : '/';
    if (!out.routes.some((r) => r.path === p)) out.routes.push({ path: p, file });
  }
  return out;
}

/** Plain HTML: every .html file is a page. */
function staticHtml(root) {
  const out = empty();
  for (const f of walk(root).filter((f) => f.endsWith('.html'))) out.routes.push({ path: '/' + f.replace(/(^|\/)index\.html$/, '$1'), file: f });
  return out;
}

const FRAMEWORKS = [
  ['next', (d) => d.next],
  ['nuxt', (d) => d.nuxt],
  ['sveltekit', (d) => d['@sveltejs/kit']],
  ['astro', (d) => d.astro],
  ['remix', (d) => d['@remix-run/dev'] || d['@remix-run/react'] || d['@react-router/dev']],
  ['eleventy', (d) => d['@11ty/eleventy']],
  ['vite', (d) => d.vite],
];
const DEFAULT_PORT = { next: 3000, nuxt: 3000, astro: 4321, sveltekit: 5173, vite: 5173, remix: 5173, eleventy: 8080 };
const MARK = { next: /\/_next\//, nuxt: /\/_nuxt\//, astro: /\/_astro\/|@vite\/client/, sveltekit: /@vite\/client|_app\//, vite: /@vite\/client/, remix: /@vite\/client|__remix|\/build\//, eleventy: /\.11ty|reload-client/ };
const PROBE = [3000, 3001, 5173, 5174, 4321, 8080, 8000, 4173, 4200];

export function framework(root) {
  const pkg = json(path.join(root, 'package.json'));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const hit = FRAMEWORKS.find(([, t]) => t(deps));
  if (hit) return hit[0];
  return walk(root, 4000).some((f) => f.endsWith('.html') && !mockupPath(f)) ? 'static' : null;
}

/** Routes for a framework, read from the file system. Dynamic routes come back as patterns. */
export function fileRoutes(root, fw) {
  const first = (...ds) => ds.find((d) => isDir(path.join(root, d)));
  const src = () => walk(root, 8000).filter((f) => /^(src|app)\/.*\.(tsx|ts|jsx|js|mjs)$/.test(f) && !/\.(test|spec)\./.test(f));
  const pkg = json(path.join(root, 'package.json')) || {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const merge = (...rs) => { const out = empty(); rs.filter(Boolean).forEach((r) => { r.routes.forEach((x) => out.routes.some((y) => y.path === x.path) || out.routes.push(x)); out.patterns.push(...r.patterns); out.notes.push(...r.notes); }); return out; };
  switch (fw) {
    case 'next': {
      const app = first('src/app', 'app');
      const pages = first('src/pages', 'pages');
      return merge(
        app && dirRouter(root, app, /^page\.(tsx|ts|jsx|js|mdx|md)$/),
        pages && fileRouter(root, pages, /\.(tsx|ts|jsx|js|mdx|md)$/, (f) => f.startsWith('api/') || /^(404|500)\./.test(f)),
      );
    }
    case 'sveltekit': return dirRouter(root, first('src/routes') || 'src/routes', /^\+page(@.*)?\.(svelte|md|svx)$/);
    case 'astro': return fileRouter(root, first('src/pages') || 'src/pages', /\.(astro|md|mdx|html)$/);
    case 'nuxt': {
      const pages = first('app/pages', 'pages');
      return pages ? fileRouter(root, pages, /\.vue$/) : { routes: [{ path: '/', file: first('app/app.vue') ? 'app/app.vue' : 'app.vue' }], patterns: [], notes: [] };
    }
    case 'remix': {
      const cfg = read(path.join(root, 'app/routes.ts'));
      if (cfg && !/flatRoutes\(/.test(cfg)) return declared(root, ['app/routes.ts']);
      return dollarRouter(root, 'app/routes');
    }
    case 'eleventy': return eleventy(root);
    case 'static': return staticHtml(root);
    case 'vite': {
      const html = fs.readdirSync(root).filter((f) => f.endsWith('.html') && f !== 'index.html').map((f) => ({ path: '/' + f, file: f }));
      let r;
      if ((deps['vite-plugin-pages'] || deps['@generouted/react-router'] || deps.generouted) && first('src/pages')) r = fileRouter(root, 'src/pages', /\.(tsx|jsx|vue|ts|js)$/);
      else if (deps['@tanstack/react-router'] && first('src/routes')) r = dollarRouter(root, 'src/routes', true);
      else if (deps['react-router-dom'] || deps['react-router'] || deps['vue-router'] || deps['@solidjs/router']) r = declared(root, src());
      else r = { ...empty(), routes: [{ path: '/', file: 'index.html' }], noRouter: true };
      if (!r.routes.some((x) => x.path === '/' || x.path === '/#/')) r.routes.unshift({ path: '/', file: 'index.html' });
      r.routes.push(...html);
      return r;
    }
    default: return empty();
  }
}

/** Concrete paths listed in a generated file (e.g. src/generated/known-paths.ts). */
function generatedPaths(root) {
  const f = walk(root, 8000).find((f) => /(^|\/)(generated|\.generated)\//.test(f) && /(known-?paths|routes?|route-?manifest|paths)\.(ts|js|mjs|json)$/i.test(f));
  if (!f) return null;
  return { file: f, paths: [...new Set([...(read(path.join(root, f)) || '').matchAll(/["'`](\/[^"'`\s]*)["'`]/g)].map((m) => m[1]))] };
}

const locs = (xml) => [...(xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => { try { return new URL(m[1]).pathname; } catch { return null; } }).filter((p) => p && !p.endsWith('.xml'));
async function sitemap(root, url) {
  const files = ['public/sitemap.xml', 'static/sitemap.xml', 'sitemap.xml'].map((f) => read(path.join(root, f))).filter(Boolean);
  let live = null;
  if (url) { try { const r = await fetch(new URL('/sitemap.xml', url), { signal: AbortSignal.timeout(1500) }); if (r.ok) live = await r.text(); } catch { /* not served */ } }
  return [...new Set([...files, live].flatMap(locs))];
}

/** Sample up to 3 values for /name/* patterns from a content folder of the same name (content/<name>/<slug>.*). */
function sample(root, pattern) {
  const m = pattern.match(/^((?:\/[^/*]+)*)\/([^/*]+)\/\*$/);
  if (!m) return [];
  const dir = ['content', 'src/content', 'data', 'src/data', 'posts', '_posts'].map((d) => path.join(root, d, m[2])).find(isDir);
  if (!dir) return [];
  return fs.readdirSync(dir).filter((f) => !f.startsWith('_') && !f.startsWith('.') && !/^index\./.test(f)).map((f) => f.replace(/\.\w+$/, '')).slice(0, 3).map((s) => `${m[1]}/${m[2]}/${s}`);
}

// shortcut: frames are capped at MAX_ROUTES routes, raise it or use "exclude" when a site has more pages worth reviewing.
export const MAX_ROUTES = 60;

/** Concrete routes for the board: file routes + generated lists + sitemap + sampled dynamic routes, mapped to source files. */
export async function routes(root, fw, { url, manual, exclude = [] } = {}) {
  if (Array.isArray(manual)) return { list: manual.map((p) => ({ path: p, file: null, via: 'config' })), via: ['config'], skipped: [], notes: [], confidence: manual.length ? 'high' : 'manual' };
  const fsr = fileRoutes(root, fw);
  const list = fsr.routes.map((r) => ({ ...r, via: 'files' }));
  const via = list.length ? ['files'] : [];
  const fileOf = (p) => fsr.routes.find((r) => r.path === p)?.file ?? fsr.patterns.find((x) => rx(x.pattern).test(p))?.file ?? null;
  const put = (p, how) => { if (!list.some((r) => r.path === p)) list.push({ path: p, file: fileOf(p), via: how }); };
  const gen = generatedPaths(root);
  if (gen?.paths.length) { gen.paths.forEach((p) => put(p, 'generated')); via.push(gen.file); }
  const sm = await sitemap(root, url);
  if (sm.length) { sm.forEach((p) => put(p, 'sitemap')); via.push('sitemap.xml'); }
  const skipped = [];
  for (const { pattern } of fsr.patterns) {
    if (list.some((r) => r.via !== 'files' && rx(pattern).test(r.path))) continue; // listed by a generated file or sitemap
    const s = sample(root, pattern);
    if (s.length) s.forEach((p) => put(p, 'sampled'));
    else skipped.push(pattern);
  }
  if (list.some((r) => r.via === 'sampled')) via.push('sampled');
  let out = list.filter((r) => !exclude.some((x) => r.path === x || r.path.startsWith(x.replace(/\/?$/, '/'))));
  const notes = [...fsr.notes];
  if (out.length > MAX_ROUTES) { notes.push(`${out.length} routes, showing the first ${MAX_ROUTES}; add "exclude" prefixes or a "routes" list`); out = out.slice(0, MAX_ROUTES); }
  const confidence = !out.length ? 'manual' : fsr.noRouter || fsr.relative || (via.length === 1 && via[0] === 'sitemap.xml') ? 'medium' : 'high';
  return { list: out, via, skipped, notes, confidence, noRouter: !!fsr.noRouter };
}

// ---------- dev server ----------
function packageManager(root) {
  for (let d = path.resolve(root); ; d = path.dirname(d)) {
    for (const [f, pm] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun'], ['package-lock.json', 'npm']]) if (fs.existsSync(path.join(d, f))) return pm;
    if (path.dirname(d) === d) return 'npm';
  }
}

/** Dev port and where it came from: script flag, framework config, site.config.json, .env, or the framework default. */
export function devPort(root, fw) {
  const pkg = json(path.join(root, 'package.json')) || {};
  const script = Object.entries(pkg.scripts || {}).find(([k]) => k === 'dev') || Object.entries(pkg.scripts || {}).find(([k]) => k === 'start' || k === 'serve');
  const fromScript = script?.[1].match(/(?:--port[= ]|\s-p[= ]?|PORT=)(\d{2,5})/);
  if (fromScript) return { port: +fromScript[1], source: `package.json "${script[0]}"`, script: script[0], inScript: true };
  const base = { script: script?.[0] };
  for (const f of fs.readdirSync(root).filter((f) => /^(vite|next|nuxt|astro|svelte|remix|react-router)\.config\.(ts|js|mjs|cjs|mts)$/.test(f))) {
    const src = read(path.join(root, f)) || '';
    const m = src.match(/(?:server|devServer)\s*:\s*\{[^}]*?\bport\s*:\s*(\d{2,5})/) || src.match(/\bport\s*:\s*(\d{2,5})/);
    if (m) return { ...base, port: +m[1], source: f };
  }
  const site = json(path.join(root, 'site.config.json'));
  if (Number.isInteger(site?.port)) return { ...base, port: site.port, source: 'site.config.json' };
  for (const f of ['.env.local', '.env.development', '.env']) {
    const m = (read(path.join(root, f)) || '').match(/^PORT\s*=\s*["']?(\d{2,5})/m);
    if (m) return { ...base, port: +m[1], source: f };
  }
  return DEFAULT_PORT[fw] ? { ...base, port: DEFAULT_PORT[fw], source: 'default' } : { ...base, port: null, source: null };
}

function startCommand(root, fw, p) {
  if (!p.script) return null;
  const pm = packageManager(root);
  const run = pm === 'npm' ? `npm run ${p.script}` : `${pm} ${p.script}`;
  if (!['site.config.json', '.env', '.env.local', '.env.development'].includes(p.source)) return run; // the framework reads its own config
  const flag = fw === 'next' ? `-p ${p.port}` : `--port ${p.port}`;
  return pm === 'npm' ? `${run} -- ${flag}` : `${run} ${flag}`;
}

/** Is anything answering at url? Returns the page text (or '' for a redirect/error) or null when down. */
export async function probe(url, ms = 1200) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return r.headers.get('content-type')?.includes('html') ? await r.text() : '';
  } catch { return null; }
}

const mockupPath = (f) => {
  const parts = f.split('/').slice(0, -1);
  return parts.some((s) => /^(mock-?ups?|protos?|prototypes?|designs?|wireframes?)$/i.test(s)) && !parts.some((s) => /^(tools?|tooling|public|static|src|archives?)$/i.test(s));
};

/** Mockup folders: .html files under a folder named mockups / prototype / design / wireframes (outside app routes). */
export function mockups(root, fw) {
  if (fw === 'static') return [];
  const dirs = new Map();
  for (const f of walk(root).filter((f) => f.endsWith('.html'))) {
    if (!mockupPath(f)) continue;
    const d = f.split('/').slice(0, -1).join('/');
    dirs.set(d, (dirs.get(d) || 0) + 1);
  }
  return [...dirs].map(([dir, files]) => ({ path: dir, files }));
}

/** Full detection for init: framework, dev URL (probed), routes, start command, mockups and a confidence grade. */
export async function detect(root, { probePorts = true, exclude } = {}) {
  const fw = framework(root);
  const notes = [];
  let port = fw && fw !== 'static' ? devPort(root, fw) : { port: null, source: null };
  let url = port.port ? `http://localhost:${port.port}` : null;
  let live = url ? (await probe(url)) !== null : false;
  let portConf = fw === 'static' ? 'high' : !port.port ? 'manual' : port.source === 'default' && !live ? 'medium' : 'high';
  if (probePorts && fw && fw !== 'static' && !live && port.source === 'default') {
    const hits = await Promise.all(PROBE.filter((p) => p !== port.port).map(async (p) => ({ p, html: await probe(`http://localhost:${p}`) })));
    const hit = hits.find((h) => h.html && MARK[fw]?.test(h.html));
    if (hit) {
      port = { ...port, port: hit.p, source: `probe (a live ${fw} server, not proven to be this repo)` };
      url = `http://localhost:${hit.p}`;
      live = true;
      portConf = 'medium';
    }
  }
  const r = fw ? await routes(root, fw, { url: live ? url : null, exclude }) : { list: [], via: [], skipped: [], notes: [], confidence: 'manual' };
  notes.push(...r.notes);
  if (r.noRouter) notes.push('no router found; list client-side screens in app.routes');
  const rank = { high: 2, medium: 1, manual: 0 };
  const confidence = [fw ? 'high' : 'manual', portConf, r.confidence].sort((a, b) => rank[a] - rank[b])[0];
  return {
    framework: fw,
    url,
    port: port.port,
    portSource: port.source,
    live,
    start: fw && fw !== 'static' ? startCommand(root, fw, port) : null,
    routes: r.list,
    routeSources: r.via,
    skipped: r.skipped,
    mockups: mockups(root, fw),
    notes,
    confidence,
  };
}
