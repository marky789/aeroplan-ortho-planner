import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { preview } from 'vite';

// Test the real production artifact through HTTP, including the project prefix.
// Run after `npm run build` with the same VITE_BASE_PATH value.
const base = process.env.VITE_BASE_PATH || '/';
let server, origin;

before(async () => {
  await access('dist/index.html');
  server = await preview({
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
  });
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
});

test('production entry and JavaScript/CSS assets load from the deployment prefix', async () => {
  const response = await fetch(`${origin}${base}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /航域 AeroPlan/);
  const urls = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]);
  assert.ok(urls.some(url => url.endsWith('.js')));
  assert.ok(urls.some(url => url.endsWith('.css')));
  for (const url of urls) {
    assert.ok(url.startsWith(`${base}assets/`), `Asset escapes deployment prefix: ${url}`);
    const asset = await fetch(new URL(url, origin));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), url.endsWith('.css') ? /text\/css/ : /javascript/);
    const source = await asset.text();
    if (url.endsWith('.js')) {
      assert.ok(source.includes(`${base}cesium/`), 'Cesium must use the same deployment prefix');
      const worker = (await readdir('dist/assets')).find(name => /^planner\.worker-.+\.js$/.test(name));
      assert.ok(worker && source.includes(`${base}assets/${worker}`), 'The browser must request the planner worker using the project prefix');
    }
  }
});

test('Cesium static data and geometry worker return real assets instead of HTML fallback', async () => {
  const heights = await fetch(`${origin}${base}cesium/Assets/approximateTerrainHeights.json`);
  assert.equal(heights.status, 200);
  assert.match(heights.headers.get('content-type'), /application\/json/);
  assert.ok(Object.keys(await heights.json()).length > 100);
  const worker = await fetch(`${origin}${base}cesium/Workers/createPolygonGeometry.js`);
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get('content-type'), /javascript/);
  assert.doesNotMatch(await worker.text(), /<!doctype html>/i);
});

test('route planner worker is emitted and served from the deployment prefix', async () => {
  const workers = (await readdir('dist/assets')).filter(name => /^planner\.worker-.+\.js$/.test(name));
  assert.equal(workers.length, 1);
  const response = await fetch(`${origin}${base}assets/${workers[0]}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(await response.text(), /onmessage/);
  await assert.rejects(access('dist/.env.local'), { code: 'ENOENT' });
});
