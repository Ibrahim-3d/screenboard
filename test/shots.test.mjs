import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../src/store.mjs';
import { NAME, PREFIX, COMMENTS_FILE, SHOTS_DIR } from '../src/name.mjs';
import { createBoard, listen } from '../src/server.mjs';

const BIN = fileURLToPath(new URL('../bin/screenboard.mjs', import.meta.url));
const PNG64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG = 'data:image/png;base64,' + PNG64;
const AUTHORS = ['human', 'agent'];
const BOX = { frame: 'desktop:/', selector: '#hero', x: 10, y: 20, w: 30, h: 40, px: { x: 1, y: 2, w: 3, h: 4 }, dpr: 1.5, viewport: { w: 1440, h: 900 } };
const made = [];
after(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true }))); // our own temp folders
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `${NAME}-shots-`)); made.push(d); return d; };

test('png(): accepts a real PNG, refuses other bytes, wrong type, oversize and absurd dimensions', () => {
  assert.equal(store.png(PNG, 'x').length, 70);
  assert.throws(() => store.png('data:image/jpeg;base64,' + PNG64, 'x'), /PNG data URL/);
  assert.throws(() => store.png('data:image/png;base64,' + Buffer.from('GIF89a-not-a-png-at-all-padding-xx').toString('base64'), 'x'), /not a PNG/);
  const huge = Buffer.from(PNG64, 'base64');
  huge.writeUInt32BE(20000, 16);
  assert.throws(() => store.png('data:image/png;base64,' + huge.toString('base64'), 'x'), /bad size/);
  assert.throws(() => store.png('data:image/png;base64,' + Buffer.alloc(11 * 1024 * 1024).toString('base64'), 'x'), /over 10 MB/);
});

test('box(): validates every field, clamps percentages, rejects junk', () => {
  const b = store.box({ ...BOX, x: 120.04 });
  assert.equal(b.x, 100);
  assert.deepEqual(b.viewport, { w: 1440, h: 900 });
  assert.throws(() => store.box({ ...BOX, dpr: 'two' }), /box.dpr/);
  assert.throws(() => store.box({ ...BOX, px: null }), /box.px.x/);
  assert.throws(() => store.box(null), /box missing/);
});

test('codes and file names: next free code counts pins and files; codes are never paths', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'SB-0041.png'), '');
  assert.equal(store.nextCode([{ shot: { code: 'SB-0007' } }, {}], dir, 'SB'), 'SB-0042');
  assert.equal(store.nextCode([], path.join(dir, 'missing'), 'SB'), 'SB-0001');
  assert.deepEqual(store.shotFiles(dir, 'SB-0001'), { file: path.join(dir, 'SB-0001.png'), ctxFile: path.join(dir, 'SB-0001-ctx.png') });
  for (const bad of ['../SB-0001', 'SB-0001/..', 'sb-0001', 'SB-1', '', undefined]) assert.throws(() => store.shotFiles(dir, bad), /bad shot code/);
});

test('schema: old pins without a shot stay valid; updates keep a shot and never take one from the client', () => {
  const old = [{ id: 'p1', screen: '/', frame: null, selector: 'b', x: 1, y: 1, text: 'old pin', author: 'human', status: 'open', createdAt: '2026-01-01T00:00:00.000Z', thread: [] }];
  const up = store.upsert(old, { id: 'p1', status: 'resolved', shot: { code: 'SB-0001', file: '../../x' } }, AUTHORS);
  assert.equal(up[0].shot, undefined);
  assert.equal(up[0].status, 'resolved');
  const withShot = store.attachShot(up, 'p1', { code: 'SB-0001', file: '.screenboard/shots/SB-0001.png', ctxFile: '.screenboard/shots/SB-0001-ctx.png', box: store.box(BOX), method: 'dom' });
  assert.deepEqual(Object.keys(withShot[0]), ['id', 'screen', 'frame', 'selector', 'x', 'y', 'shot', 'text', 'author', 'status', 'createdAt', 'thread']);
  const moved = store.upsert(withShot, { id: 'p1', x: 50 }, AUTHORS);
  assert.equal(moved[0].shot.code, 'SB-0001');
  assert.equal(moved[0].x, 50);
});

test('server: a request over the size cap gets 413, nothing written', async () => {
  const root = tmp();
  const file = path.join(root, COMMENTS_FILE);
  const board = createBoard({ root, cfg: { authors: AUTHORS }, commentsFile: file });
  const port = await listen(board, 0);
  const status = await new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: PREFIX + '/api/comments', method: 'POST', headers: { host: `localhost:${port}`, 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    r.end(JSON.stringify({ pin: {}, shot: { png: 'x'.repeat(31 * 1024 * 1024) } }));
  });
  board.close();
  assert.equal(status, 413);
  assert.ok(!fs.existsSync(file));
});

test('CLI: comments prints the shot code and absolute paths, --json carries them, shot <code|id> prints both files', () => {
  const root = tmp();
  const shots = path.join(root, SHOTS_DIR);
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(path.join(shots, 'SB-0003.png'), Buffer.from(PNG64, 'base64'));
  fs.writeFileSync(path.join(shots, 'SB-0003-ctx.png'), Buffer.from(PNG64, 'base64'));
  fs.writeFileSync(path.join(root, COMMENTS_FILE), JSON.stringify([
    { id: 'p1', screen: '/', frame: null, selector: 'b', x: 1, y: 1, text: 'no box', author: 'human', status: 'open', createdAt: '2026-01-01T00:00:00.000Z', thread: [] },
    { id: 'p2', screen: '/', frame: null, selector: '#hero', x: 10, y: 20, shot: { code: 'SB-0003', file: `${SHOTS_DIR}/SB-0003.png`, ctxFile: `${SHOTS_DIR}/SB-0003-ctx.png`, box: BOX, method: 'dom' }, text: 'this area', author: 'human', status: 'open', createdAt: '2026-01-01T00:00:00.000Z', thread: [] },
  ]));
  const cli = (...a) => execFileSync(process.execPath, [BIN, ...a], { cwd: root, encoding: 'utf8' });
  const text = cli('comments', '--open');
  assert.match(text, /#2 open/);
  assert.match(text, /shot: SB-0003 \(dom snapshot, canvases may be blank\)/);
  assert.ok(text.includes(path.join(root, SHOTS_DIR, 'SB-0003.png')) && text.includes(path.join(root, SHOTS_DIR, 'SB-0003-ctx.png')));
  assert.equal(text.match(/shot:/g).length, 1, 'only the box pin has a shot');
  const json = JSON.parse(cli('comments', '--json'));
  assert.equal(json[1].shot.path, path.join(root, SHOTS_DIR, 'SB-0003.png'));
  assert.equal(json[0].shot, undefined);
  const both = [path.join(root, SHOTS_DIR, 'SB-0003.png'), path.join(root, SHOTS_DIR, 'SB-0003-ctx.png')].join('\n') + '\n';
  assert.equal(cli('shot', 'SB-0003'), both);
  assert.equal(cli('shot', 'sb-0003'), both);
  assert.equal(cli('shot', '2'), both);
  assert.throws(() => cli('shot', '1'), /no snapshot 1/);
});
