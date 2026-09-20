import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrariumSampler, decodeTerrariumPixels, TERRAIN_LEVEL, TERRAIN_METADATA } from './terrain-source.js';

const SIZE = 256;
const worldLL = (x, y, level = TERRAIN_LEVEL) => [x / 2 ** level * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** level))) * 180 / Math.PI];

test('Terrarium decoding preserves fractional and negative heights and rejects no-data', () => {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 128; rgba[i + 3] = 255; }
  rgba.set([137, 219, 68, 255]);
  rgba.set([127, 246, 128, 255], 4);
  const heights = decodeTerrariumPixels(rgba);
  assert.equal(heights[0], 2523.265625);
  assert.equal(heights[1], -9.5);
  rgba[3] = 0;
  assert.throws(() => decodeTerrariumPixels(rgba), /无效高程/);
  assert.throws(() => decodeTerrariumPixels(rgba, 255, 256), /尺寸/);
});

test('fixed LOD samples use pixel centres and interpolate continuously across all tile boundaries', async () => {
  const calls = [];
  const sampler = createTerrariumSampler({ loadTile: async (x, y, level) => {
    calls.push([x, y, level]);
    return Float32Array.from({ length: SIZE * SIZE }, (_, i) => (x - 4096) * SIZE + i % SIZE + 0.5 + ((y - 4096) * SIZE + Math.floor(i / SIZE) + 0.5) * 2);
  } });
  const queries = [[4096.5, 4096.5], [4096, 4096], [4096.9999, 4096.2], [4097, 4096.2], [4097.0001, 4096.2]];
  const heights = await sampler.sampleHeights(queries.map(([x, y]) => worldLL(x, y)));
  heights.forEach((value, i) => assert.ok(Math.abs(value - ((queries[i][0] - 4096) * SIZE + (queries[i][1] - 4096) * SIZE * 2)) < 1e-6));
  assert.ok(calls.every(([, , level]) => level === TERRAIN_LEVEL));
  assert.equal(TERRAIN_METADATA.verticalDatum, 'source-orthometric');
});

test('adjacent render heightmaps share exact vertices and reuse cached source tiles', async () => {
  let requests = 0;
  const sampler = createTerrariumSampler({ loadTile: async (x, y) => {
    requests++;
    return Float32Array.from({ length: SIZE * SIZE }, (_, i) => x * 20 + i % SIZE / 13 + y * 30 + Math.floor(i / SIZE) / 19);
  } });
  const left = await sampler.heightmap(10, 10, 5);
  const right = await sampler.heightmap(11, 10, 5);
  assert.equal(left.length, 257 * 257);
  for (let row = 0; row <= SIZE; row++) assert.equal(left[row * 257 + 256], right[row * 257]);
  assert.equal(requests, 12);
  await assert.rejects(sampler.heightmap(10, 10, TERRAIN_LEVEL + 1), /层级/);
});

test('sampling bounds concurrency, shares pending tiles and evicts old cached tiles', async () => {
  let active = 0, maximumActive = 0, requests = 0;
  const sampler = createTerrariumSampler({ maxCacheSize: 1, concurrency: 2, loadTile: async () => {
    active++; requests++; maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return new Float32Array(SIZE * SIZE).fill(20);
  } });
  const a = worldLL(4096 + 10.5 / SIZE, 4096 + 10.5 / SIZE);
  await Promise.all([sampler.sampleHeights([a]), sampler.sampleHeights([a])]);
  assert.equal(requests, 1);
  await sampler.sampleHeights([worldLL(4100, 4100)]);
  await sampler.sampleHeights([a]);
  assert.ok(maximumActive <= 2);
  assert.ok(requests > 5);
});

test('sampling rejects invalid coordinates, missing or invalid heights and allows retry', async () => {
  let attempts = 0;
  const sampler = createTerrariumSampler({ loadTile: async () => {
    if (++attempts === 1) throw new Error('network unavailable');
    return new Float32Array(SIZE * SIZE).fill(33);
  } });
  const point = worldLL(4096 + 10.5 / SIZE, 4096 + 10.5 / SIZE);
  await assert.rejects(sampler.sampleHeights([point]), /network/);
  assert.deepEqual(await sampler.sampleHeights([point]), [33]);
  for (const invalid of [[181, 20], [1, 90], [NaN, 1], ['1', 2]]) await assert.rejects(sampler.sampleHeights([invalid]), /坐标/);
  const missing = createTerrariumSampler({ loadTile: async () => new Float32Array(SIZE * SIZE).fill(NaN) });
  await assert.rejects(missing.sampleHeights([point]), /缺失/);
  const truncated = createTerrariumSampler({ loadTile: async () => [] });
  await assert.rejects(truncated.sampleHeights([point]), /不完整/);
});
