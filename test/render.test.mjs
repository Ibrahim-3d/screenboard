import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { NAME } from '../src/name.mjs';
import { zip, findChrome } from '../src/render.mjs';

test('zip: valid store-only archive (headers, CRC, central directory)', () => {
  const a = Buffer.from('first file');
  const b = Buffer.from('second, longer file contents');
  const z = zip([{ name: 'a.jpg', data: a }, { name: 'b.jpg', data: b }]);
  const end = z.length - 22;
  assert.equal(z.readUInt32LE(end), 0x06054b50);
  assert.equal(z.readUInt16LE(end + 10), 2);
  const cd = z.readUInt32LE(end + 16);
  assert.equal(z.readUInt32LE(cd), 0x02014b50);
  const second = z.readUInt32LE(cd + 46 + 5 + 42); // local header offset of b.jpg in its central entry
  assert.equal(z.readUInt32LE(second), 0x04034b50);
  assert.equal(z.readUInt32LE(second + 14), zlib.crc32(b));
  assert.deepEqual(z.subarray(second + 30 + 5, second + 30 + 5 + b.length), b);
});

test('render: every demo frame to a JPG + manifest (skipped without Chrome)', { skip: !findChrome() && 'no Chrome or Edge' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${NAME}-render-`));
  try {
    fs.cpSync(fileURLToPath(new URL('../demo', import.meta.url)), dir, { recursive: true, filter: (s) => !s.includes(`.${NAME}`) });
    const out = execFileSync(process.execPath, [fileURLToPath(new URL('../bin/screenboard.mjs', import.meta.url)), 'render', 'phone:'], { cwd: dir, encoding: 'utf8' });
    assert.match(out, /rendered 3\/3 frames/);
    const m = JSON.parse(fs.readFileSync(path.join(dir, `.${NAME}/renders/manifest.json`), 'utf8'));
    assert.equal(m.frames.length, 3);
    for (const f of m.frames) {
      const jpg = fs.readFileSync(path.join(dir, `.${NAME}/renders`, f.file));
      assert.equal(jpg.readUInt16BE(0), 0xffd8); // JPEG magic
      assert.equal(f.width, 390);
      assert.ok(f.height >= 844);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
