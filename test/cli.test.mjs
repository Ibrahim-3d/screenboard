import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME, CONFIG_FILE, COMMENTS_FILE } from '../src/name.mjs';
import { selfCheck } from '../src/check.mjs';

const BIN = fileURLToPath(new URL('../bin/screenboard.mjs', import.meta.url));
const made = [];
after(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true }))); // our own temp copies
const copy = (name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${NAME}-test-`));
  made.push(dir);
  fs.cpSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), dir, { recursive: true });
  return dir;
};
const cli = (cwd, ...args) => execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });

test('server self-check passes every probe', async () => {
  const results = await selfCheck();
  assert.ok(results.length >= 20);
  assert.deepEqual(results.filter((l) => !l.startsWith('ok')), []);
});

test('init --dry-run writes nothing and prints a short summary', () => {
  const dir = copy('next');
  const out = cli(dir, 'init', '--dry-run');
  assert.match(out, /next · http:\/\/localhost:3100/);
  assert.match(out, /confidence/);
  assert.ok(out.trim().split('\n').length <= 8);
  assert.ok(!fs.existsSync(path.join(dir, CONFIG_FILE)));
});

test('init writes config, skill and package.json script, then keeps the config on re-run', () => {
  const dir = copy('next');
  const out = cli(dir, 'init');
  assert.ok(out.trim().split('\n').length <= 8);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, CONFIG_FILE), 'utf8'));
  assert.equal(cfg.app.framework, 'next');
  assert.equal(cfg.app.url, 'http://localhost:3100');
  const skill = fs.readFileSync(path.join(dir, '.claude/skills', NAME, 'SKILL.md'), 'utf8');
  assert.match(skill, new RegExp(`^---\\nname: ${NAME}\\n`));
  assert.ok(!skill.includes('{{'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts.board, `npx -y ${NAME}`);
  cfg.title = 'mine';
  fs.writeFileSync(path.join(dir, CONFIG_FILE), JSON.stringify(cfg));
  assert.match(cli(dir, 'init'), /kept existing/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, CONFIG_FILE), 'utf8')).title, 'mine');
});

test('add registers mockups (folder and file#hash), refuses files outside the repo', () => {
  const dir = copy('mockups-only');
  cli(dir, 'add', 'design/mockups');
  cli(dir, 'add', 'design/mockups/home.html#hero', '--label', 'Hero', '--width', '390');
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, CONFIG_FILE), 'utf8'));
  assert.deepEqual(cfg.mockups, [{ path: 'design/mockups' }, { path: 'design/mockups/home.html#hero', label: 'Hero', width: 390 }]);
  assert.throws(() => cli(dir, 'add', os.tmpdir()), /must be inside/);
  assert.throws(() => cli(dir, 'add', 'README.md'), /not an \.html/);
});

test('comments and reply round trip: list with source + element, reply, resolve', () => {
  const dir = copy('mockups-only');
  cli(dir, 'add', 'design/mockups');
  const file = path.join(dir, COMMENTS_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([{ id: 'p1', screen: `/__${NAME}/files/design/mockups/home.html`, frame: 'mock:design/mockups/home.html', selector: '#hero', hint: '<h1#hero> Home', x: 50, y: 50, text: 'Bigger title', author: 'human', status: 'open', createdAt: '2026-01-01T00:00:00.000Z', thread: [] }]));
  const list = cli(dir, 'comments', '--open');
  assert.match(list, /#1 open · Mockups home\.html · design\/mockups\/home\.html/);
  assert.match(list, /element: <h1#hero> Home/);
  const json = JSON.parse(cli(dir, 'comments', '--json'));
  assert.equal(json[0].source, 'design/mockups/home.html');
  assert.match(cli(dir, 'reply', '1', 'Done: 48px', '--resolve'), /#1 replied, resolved/);
  const pin = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
  assert.equal(pin.status, 'resolved');
  assert.equal(pin.thread[0].author, 'agent');
  assert.equal(pin.thread[0].text, 'Done: 48px');
  assert.match(cli(dir, 'comments', '--open'), /No open comments/);
  assert.throws(() => cli(dir, 'reply', '9', 'x'), /no pin p9/);
});

test('--check exits 0', () => {
  assert.match(cli(os.tmpdir(), '--check'), /ok {3}pin deleted/);
});
