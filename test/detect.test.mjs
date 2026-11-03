import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { detect } from '../src/detect.mjs';

const fx = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const paths = (d) => d.routes.map((r) => r.path).sort();
const run = (name) => detect(fx(name), { probePorts: false });

test('next app router: groups stripped, parallel/private skipped, dynamic sampled from content/, catch-all skipped', async () => {
  const d = await run('next');
  assert.equal(d.framework, 'next');
  assert.equal(d.port, 3100);
  assert.deepEqual(paths(d), ['/', '/about', '/blog/hello-world', '/blog/second']);
  assert.deepEqual(d.skipped, ['/docs/**']);
  assert.equal(d.routes.find((r) => r.path === '/blog/second').file, 'src/app/blog/[slug]/page.tsx');
  assert.equal(d.routes.find((r) => r.path === '/about').file, 'src/app/(marketing)/about/page.tsx');
  assert.equal(d.confidence, 'high');
});

test('next pages router: _app and api skipped, generated known-paths fill dynamic routes, PORT from .env', async () => {
  const d = await run('next-pages');
  assert.deepEqual(paths(d), ['/', '/posts/1', '/posts/2', '/pricing']);
  assert.equal(d.routes.find((r) => r.path === '/posts/2').file, 'pages/posts/[id].tsx');
  assert.equal(d.port, 3200);
  assert.equal(d.portSource, '.env');
  assert.equal(d.start, 'npm run dev -- -p 3200');
  assert.deepEqual(d.skipped, []);
});

test('vite + react-router: declared paths, extra .html entry, port from vite.config, dynamic skipped', async () => {
  const d = await run('vite-router');
  assert.equal(d.framework, 'vite');
  assert.deepEqual(paths(d), ['/', '/about.html', '/settings']);
  assert.deepEqual(d.skipped, ['/users/*']);
  assert.equal(d.port, 5280);
  assert.equal(d.start, 'npm run dev');
});

test('vite without a router: "/" plus sitemap, medium confidence', async () => {
  const d = await run('vite-plain');
  assert.deepEqual(paths(d), ['/', '/pricing']);
  assert.equal(d.routes.find((r) => r.path === '/pricing').via, 'sitemap');
  assert.equal(d.confidence, 'medium');
});

test('astro: pages, _drafts and endpoints skipped, port from astro.config', async () => {
  const d = await run('astro');
  assert.deepEqual(paths(d), ['/', '/about']);
  assert.deepEqual(d.skipped, ['/blog/*']);
  assert.equal(d.port, 4400);
});

test('sveltekit: +page dirs, groups stripped, default port is medium until live', async () => {
  const d = await run('sveltekit');
  assert.deepEqual(paths(d), ['/', '/dashboard']);
  assert.deepEqual(d.skipped, ['/*']);
  assert.equal(d.port, 5173);
  assert.equal(d.confidence, 'medium');
});

test('nuxt: pages/, devServer port', async () => {
  const d = await run('nuxt');
  assert.deepEqual(paths(d), ['/', '/about']);
  assert.equal(d.port, 3300);
  assert.deepEqual(d.skipped, ['/users/*']);
});

test('remix flat routes: _index, pathless _auth, folder route.tsx, modules ignored', async () => {
  const d = await run('remix');
  assert.equal(d.framework, 'remix');
  assert.deepEqual(paths(d), ['/', '/about', '/blog', '/contact', '/login']);
  assert.deepEqual(d.skipped, ['/blog/*']);
});

test('eleventy: input dir, permalink, pagination and _includes skipped, --port= in script', async () => {
  const d = await run('eleventy');
  assert.deepEqual(paths(d), ['/', '/about/', '/p/special/']);
  assert.equal(d.port, 8181);
  assert.ok(d.notes.some((n) => n.includes('pagination')));
});

test('static html: every .html is a page, served by the board (no dev server)', async () => {
  const d = await run('static');
  assert.equal(d.framework, 'static');
  assert.deepEqual(paths(d), ['/', '/about.html', '/docs/guide/']);
  assert.equal(d.url, null);
  assert.equal(d.start, null);
});

test('mockups-only repo: no app, mockup folder found', async () => {
  const d = await run('mockups-only');
  assert.equal(d.framework, null);
  assert.deepEqual(d.mockups, [{ path: 'design/mockups', files: 2 }]);
  assert.equal(d.confidence, 'manual');
});
