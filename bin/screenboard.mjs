#!/usr/bin/env node
// CLI: init · dev (default) · add · comments · reply · shot · --check. See README.md.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { NAME, VERSION, CONFIG_FILE, COMMENTS_FILE, PREFIX, RUN, BOARD_PORT } from '../src/name.mjs';
import { detect, probe } from '../src/detect.mjs';
import { buildFrames, findRoot, loadConfig, saveConfig, mockupFiles, DEFAULTS } from '../src/config.mjs';
import { createBoard, listen } from '../src/server.mjs';
import * as store from '../src/store.mjs';
import { selfCheck } from '../src/check.mjs';

const argv = process.argv.slice(2);
const VALUED = ['--port', '--label', '--width', '--height'];
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const has = (n) => argv.includes(n);
const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
const out = (...l) => console.log(l.join('\n'));
const fail = (m) => { console.error(`${NAME}: ${m}`); process.exit(1); };
const posix = (p) => p.split(path.sep).join('/');

const HELP = `${NAME} ${VERSION}

  ${NAME} init [--dry-run] [--no-skill] [--no-script]   detect the app, write ${CONFIG_FILE}, install the agent skill
  ${NAME} [dev] [--port N] [--start] [--open]           start the board (--start also starts the app's dev server)
  ${NAME} add <file.html|folder>... [--label X] [--width N] [--height N]
  ${NAME} comments [--open|--resolved] [--json]          list pins (frame, source file, element, thread)
  ${NAME} reply <id> ["text"] [--resolve|--reopen]       answer a pin as the agent
  ${NAME} shot <code|id>                                 absolute paths of a box pin's snapshot PNGs
  ${NAME} --check                                        self-test`;

/** A config from detection: only keys that differ from the defaults are written. */
function configFrom(root, det) {
  const cfg = { title: path.basename(root), port: BOARD_PORT, authors: DEFAULTS.authors };
  if (det.framework) cfg.app = { framework: det.framework, url: det.url, start: det.start };
  if (det.framework && !det.routes.length) cfg.app.routes = ['/'];
  if (det.mockups.length) cfg.mockups = det.mockups.map((m) => ({ path: m.path }));
  return cfg;
}

function summary(det) {
  const lines = [];
  if (!det.framework) lines.push('no app found (no framework, no .html): mockups only');
  else if (det.framework === 'static') lines.push(`static HTML site, served by the board`);
  else lines.push(`${det.framework} · ${det.url ?? 'no port'} (${det.portSource ?? 'unknown'}) · ${det.live ? 'running' : `not running: ${det.start ?? 'start it yourself'}`}`);
  if (det.framework) lines.push(`routes ${det.routes.length} via ${det.routeSources.join(', ') || 'nothing'}${det.skipped.length ? ` · skipped ${det.skipped.join(' ')}` : ''} · confidence ${det.confidence}`);
  if (det.mockups.length) lines.push(`mockups ${det.mockups.map((m) => `${m.path} (${m.files})`).join(', ')}`);
  det.notes.slice(0, 2).forEach((n) => lines.push('note: ' + n));
  return lines;
}

async function init() {
  const root = process.cwd();
  const det = await detect(root);
  const lines = summary(det);
  const wrote = [];
  if (has('--dry-run')) return out(...lines, 'dry run: nothing written');
  if (!loadConfig(root)) { saveConfig(root, configFrom(root, det)); wrote.push(CONFIG_FILE); }
  else lines.push(`kept existing ${CONFIG_FILE}`);
  if (!has('--no-skill')) {
    const dest = path.join(root, '.claude', 'skills', NAME, 'SKILL.md');
    const tpl = fs.readFileSync(new URL('../skill/SKILL.md', import.meta.url), 'utf8');
    const vars = { NAME, RUN, CONFIG_FILE, COMMENTS_FILE };
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k]), 'utf8');
    wrote.push(posix(path.relative(root, dest)));
  }
  const pkgFile = path.join(root, 'package.json');
  if (!has('--no-script') && fs.existsSync(pkgFile)) {
    const text = fs.readFileSync(pkgFile, 'utf8');
    const pkg = JSON.parse(text);
    if (!pkg.scripts?.board) {
      pkg.scripts = { ...pkg.scripts, board: RUN };
      const indent = (text.match(/^([ \t]+)"/m) || [, '  '])[1];
      fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, indent) + '\n', 'utf8');
      wrote.push('package.json "board" script');
    }
  }
  if (wrote.length) lines.push('wrote ' + wrote.join(', '));
  lines.push(`next: ${RUN} --open`);
  out(...lines.slice(0, 8));
}

async function dev() {
  const root = findRoot();
  let cfg = loadConfig(root);
  if (!cfg) {
    const det = await detect(root);
    cfg = configFrom(root, det);
    out(...summary(det), `no ${CONFIG_FILE}: using detection (run "${NAME} init" to keep it)`);
  }
  const appUrl = cfg.app?.url;
  let live = appUrl ? (await probe(appUrl)) !== null : null;
  if (appUrl && !live && has('--start')) {
    if (!cfg.app.start) fail('no start command known; set app.start in ' + CONFIG_FILE);
    out(`starting: ${cfg.app.start}`);
    spawn(cfg.app.start, { cwd: root, shell: true, stdio: 'inherit' });
    for (let i = 0; i < 120 && !live; i++) { await new Promise((r) => setTimeout(r, 1000)); live = (await probe(appUrl)) !== null; }
    if (!live) out(`dev server did not answer on ${appUrl} after 2 minutes; the board will show it when it does`);
  }
  const server = createBoard({ root, cfg, commentsFile: path.join(root, COMMENTS_FILE) });
  const port = await listen(server, Number(val('--port')) || cfg.port || BOARD_PORT, !!val('--port')).catch((e) => fail(e.message));
  const url = `http://localhost:${port}${PREFIX}/`;
  out(`board → ${url}`);
  if (appUrl && !live) out(`app not running on ${appUrl}: ${cfg.app.start || 'start it'} (or rerun with --start)`);
  if (has('--open')) {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  }
}

function add() {
  const root = findRoot();
  if (!pos.slice(1).length) fail('usage: add <file.html|folder>...');
  const cfg = loadConfig(root) || { title: path.basename(root), port: BOARD_PORT, authors: DEFAULTS.authors };
  cfg.mockups ||= [];
  const added = [];
  for (const arg of pos.slice(1)) {
    const i = arg.search(/[?#]/);
    const [p, suffix] = i < 0 ? [arg, ''] : [arg.slice(0, i), arg.slice(i)];
    const abs = path.resolve(p);
    const rel = posix(path.relative(root, abs));
    if (!fs.existsSync(abs)) fail(`${arg}: not found`);
    if (rel.startsWith('..') || path.isAbsolute(rel)) fail(`${arg}: must be inside ${root}`);
    if (!fs.statSync(abs).isDirectory() && !/\.html?$/i.test(abs)) fail(`${arg}: not an .html file or a folder`);
    const entry = { path: (rel || '.') + suffix };
    if (val('--label')) entry.label = val('--label');
    if (val('--width')) entry.width = Number(val('--width'));
    if (val('--height')) entry.height = Number(val('--height'));
    const files = mockupFiles(root, entry);
    if (!files.length) fail(`${arg}: no .html files`);
    cfg.mockups = cfg.mockups.filter((m) => m.path !== entry.path).concat(entry);
    added.push(`${entry.path} (${files.length} frame${files.length === 1 ? '' : 's'})`);
  }
  saveConfig(root, cfg);
  out(`added ${added.join(', ')}`, 'reload the board to see them');
}

const idOf = (s) => (/^#?\d+$/.test(s || '') ? 'p' + s.replace('#', '') : s);

async function comments() {
  const root = findRoot();
  const cfg = loadConfig(root) || {};
  const pins = store.read(path.join(root, COMMENTS_FILE)).filter((p) => (has('--open') ? p.status === 'open' : has('--resolved') ? p.status === 'resolved' : true));
  const frames = await buildFrames(root, cfg, { live: false });
  const files = PREFIX + '/files/';
  const rows = pins.map((p) => {
    const f = frames.find((x) => x.id === p.frame);
    const screenFile = p.screen.startsWith(files) ? decodeURI(p.screen.slice(files.length).split('#')[0]) : null;
    const row = { ...p, where: f ? [f.space, f.device, f.label].filter(Boolean).join(' ') : p.screen, source: f?.source ?? screenFile ?? frames.find((x) => x.url === p.screen)?.source ?? null };
    if (p.shot) row.shot = { ...p.shot, path: path.join(root, p.shot.file), ctxPath: path.join(root, p.shot.ctxFile) };
    return row;
  });
  if (has('--json')) return out(JSON.stringify(rows, null, 2));
  if (!rows.length) return out(has('--open') ? 'No open comments.' : 'No comments.');
  for (const r of rows) {
    out(`#${r.id.slice(1)} ${r.status} · ${r.where}${r.source ? ` · ${r.source}` : ''}`);
    if (r.hint) out(`   element: ${r.hint}`);
    if (r.shot) out(`   shot: ${r.shot.code}${r.shot.method === 'dom' ? ' (dom snapshot, canvases may be blank)' : ''}`, `     box: ${r.shot.path}`, `     in context: ${r.shot.ctxPath}`);
    out(`   selector: ${r.selector}`, `   ${r.author}: ${r.text}`, ...(r.thread || []).map((t) => `   ${t.author}: ${t.text}`), '');
  }
  const open = rows.filter((r) => r.status === 'open').length;
  out(`${open} open, ${rows.length - open} resolved`);
}

function reply() {
  const root = findRoot();
  const cfg = loadConfig(root) || {};
  const authors = cfg.authors || DEFAULTS.authors;
  const file = path.join(root, COMMENTS_FILE);
  const id = idOf(pos[1]);
  const text = pos[2];
  if (!id || (!text && !has('--resolve') && !has('--reopen'))) fail('usage: reply <id> "text" [--resolve|--reopen]');
  let list = store.read(file);
  const p = list.find((x) => x.id === id);
  if (!p) fail(`no pin ${id}`);
  const change = { id };
  if (text) change.thread = [...(p.thread || []), { author: authors[1], text, createdAt: new Date().toISOString() }];
  if (has('--resolve')) change.status = 'resolved';
  if (has('--reopen')) change.status = 'open';
  list = store.upsert(list, change, authors);
  store.write(file, list);
  out(`#${id.slice(1)} ${[text && 'replied', change.status].filter(Boolean).join(', ')}`);
}

async function check() {
  const results = await selfCheck();
  out(...results);
  process.exit(results.every((l) => l.startsWith('ok')) ? 0 : 1);
}

const cmd = has('--check') ? 'check' : has('--help') || pos[0] === 'help' ? 'help' : has('--version') ? 'version' : pos[0] || 'dev';
function shot() {
  const root = findRoot();
  const key = pos[1];
  if (!key) fail('usage: shot <code|id>');
  const p = store.read(path.join(root, COMMENTS_FILE)).find((x) => x.shot && (x.shot.code === key.toUpperCase() || x.id === idOf(key)));
  if (!p) fail(`no snapshot ${key}`);
  out(path.join(root, p.shot.file), path.join(root, p.shot.ctxFile));
}

const run = { init, dev, add, comments, reply, shot, check, help: () => out(HELP), version: () => out(VERSION) }[cmd];
if (!run) fail(`unknown command "${cmd}"\n\n${HELP}`);
Promise.resolve(run()).catch((e) => fail(e.message));
