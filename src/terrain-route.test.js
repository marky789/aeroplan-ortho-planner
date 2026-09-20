import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalProjection, DEFAULT_OPTIONS, planMission } from './planner.js';
import { attachTerrainToPlan, MAX_TERRAIN_SAMPLES } from './terrain-route.js';

const origin = [116.39, 39.9];
const frame = createLocalProjection([origin]);
const ll = point => frame.inverse(point);
const options = { ...DEFAULT_OPTIONS, altitude: 100, terrainSampleSpacing: 30, speed: 6, turnSeconds: 3 };
const metadata = { source: 'Test DEM', verticalDatum: 'source-native-test' };
const close = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

function fixture(segments, connectors = []) {
  const legs = segments.map((points, index) => {
    const photos = points.map(ll);
    return { id: index + 1, pass: 1, start: photos[0], end: photos.at(-1), photos };
  });
  return {
    legs, connections: connectors.map(points => ({ positions: points.map(ll) })),
    photos: legs.flatMap(leg => leg.photos), projectionOrigin: origin,
    stats: { photoCount: legs.reduce((sum, leg) => sum + leg.photos.length, 0), capturePauseSeconds: 7 }, warnings: [],
  };
}

test('flat terrain preserves horizontal mission and applies the source height to every output', async () => {
  const polygon = [[0, 0], [300, 0], [300, 200], [0, 200]].map(ll);
  const input = planMission(polygon, { ...options, autoHeading: false, heading: 90 });
  const before = JSON.stringify(input);
  const actual = await attachTerrainToPlan(input, options, async points => points.map(() => -12.5), metadata);
  close(actual.stats.distanceM, input.stats.distanceM, 0.001);
  close(actual.stats.durationSeconds, input.stats.durationSeconds);
  assert.equal(JSON.stringify(input), before, 'attaching terrain must not mutate the horizontal plan');
  assert.equal(actual.terrain.status, 'ready');
  assert.equal(actual.terrain.verticalDatum, metadata.verticalDatum);
  assert.equal(actual.stats.terrainMinM, -12.5);
  assert.equal(actual.stats.absoluteHeightMaxM, 87.5);
  assert.equal(actual.stats.maxClimbGradient, 0);
  assert.equal(actual.stats.maxRequiredDescentRateMps, 0);
  for (const p of [...actual.path, ...actual.photos, ...actual.legs.flatMap(leg => [leg.start, leg.end, ...leg.positions]), ...actual.connections.flatMap(line => line.positions)]) assert.equal(p[2], 87.5);
});

test('a fixed slope produces analytically correct three-dimensional distance and climb rate', async () => {
  const input = fixture([[[0, 0], [50, 0], [100, 0]]]);
  const actual = await attachTerrainToPlan(input, options, async points => points.map(p => frame.forward(p)[0] / 2), metadata);
  const distance = Math.hypot(100, 50);
  close(actual.stats.horizontalDistanceM, 100);
  close(actual.stats.distanceM, distance);
  close(actual.stats.durationSeconds, distance / 6 + 7);
  close(actual.stats.maxClimbGradient, 0.5);
  close(actual.stats.maxRequiredClimbRateMps, 6 * 50 / distance);
  close(actual.stats.elevationGainM, 50);
  close(actual.stats.terrainMinM, 0);
  close(actual.stats.terrainMaxM, 50);
  assert.equal(actual.legs[0].positions.length, 5);
  assert.ok(actual.warnings.some(message => message.includes('尚未按飞行器性能自动减速')));
  for (const p of actual.path) close(p[2] - frame.forward(p.slice(0, 2))[0] / 2, 100);
});

test('densification retains detour corners and samples a peak absent from the exposure points', async () => {
  const input = fixture(
    [[[0, 0], [100, 0]], [[200, 0], [300, 0]]],
    [[[100, 0], [100, 100], [200, 100], [200, 0]]],
  );
  const actual = await attachTerrainToPlan(input, options, async points => points.map(p => frame.forward(p)[1] * 0.6), metadata);
  close(actual.stats.terrainMaxM, 60);
  close(actual.stats.absoluteHeightMaxM, 160);
  close(actual.stats.captureDistanceM, 200);
  close(actual.stats.transitDistanceM, 2 * Math.hypot(100, 60) + 100);
  close(actual.stats.elevationGainM, 60);
  close(actual.stats.elevationLossM, 60);
  for (const original of input.connections[0].positions) assert.ok(actual.connections[0].positions.some(p => p[0] === original[0] && p[1] === original[1]));
  const xy = actual.connections[0].positions.map(p => frame.forward(p.slice(0, 2)));
  for (let i = 1; i < xy.length; i++) {
    assert.ok(Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]) <= 30.00001);
    const p = xy[i];
    assert.ok(Math.abs(p[0] - 100) < 1e-5 || Math.abs(p[1] - 100) < 1e-5 || Math.abs(p[0] - 200) < 1e-5, 'samples must remain on the permitted metric detour');
  }
});

test('photos are retained exactly and native capture requests share their sampled station height', async () => {
  const input = fixture([[[0, 0], [17, 0], [43, 0], [100, 0]]]);
  input.captureRequests = input.photos.map((position, stationIndex) => ({ stationIndex, position, mode: 'smartOrtho', directionCount: 3, nativeAngles: null, nativeTiming: null }));
  input.stats.photoCount = input.photos.length * 3;
  input.stats.stationCount = input.photos.length;
  const sampled = [];
  const actual = await attachTerrainToPlan(input, options, async points => { sampled.push(...points); return points.map(p => frame.forward(p)[0]); }, metadata);
  assert.equal(actual.stats.photoCount, 12);
  assert.equal(actual.stats.stationCount, 4);
  assert.equal(actual.photos.length, 4);
  for (let i = 0; i < actual.photos.length; i++) assert.deepEqual(actual.photos[i].slice(0, 2), input.photos[i]);
  for (const request of actual.captureRequests) {
    assert.deepEqual(request.position, actual.photos[request.stationIndex]);
    assert.equal(request.nativeAngles, null);
    assert.equal(request.nativeTiming, null);
  }
  const keys = sampled.map(p => p.map(value => value.toFixed(12)).join(','));
  assert.equal(new Set(keys).size, keys.length, 'shared photo/request/route points must only be fetched once');
  assert.equal(actual.terrain.sampleCount, sampled.length);
});

test('terrain requests are chunked at 256 points without losing points or order', async () => {
  const input = fixture([[[0, 0], [12000, 0]]]);
  const batches = [];
  const actual = await attachTerrainToPlan(input, { ...options, terrainSampleSpacing: 20 }, async points => {
    batches.push(points.length);
    return points.map(p => frame.forward(p)[0] / 100);
  }, metadata);
  assert.ok(batches.length >= 3);
  assert.ok(batches.every(size => size <= 256));
  assert.equal(batches.reduce((sum, size) => sum + size, 0), actual.terrain.sampleCount);
  for (const p of actual.path) close(p[2], frame.forward(p.slice(0, 2))[0] / 100 + 100);
});

test('failed or incomplete terrain never creates zero-height output and leaves the input unchanged', async () => {
  const input = fixture([[[0, 0], [100, 0]]]);
  const before = JSON.stringify(input);
  for (const sampler of [
    async () => { throw new Error('network unavailable'); },
    async () => [],
    async points => points.map(() => undefined),
    async points => points.map(() => null),
    async points => points.map(() => NaN),
    async points => points.map(() => Infinity),
    async points => points.map(() => '123'),
  ]) {
    await assert.rejects(attachTerrainToPlan(input, options, sampler), /地形/);
    assert.equal(JSON.stringify(input), before);
  }
});

test('the sampling limit rejects an oversized route before requesting any data', async () => {
  const input = fixture([[[0, 0], [(MAX_TERRAIN_SAMPLES + 1) * 5, 0]]]);
  let called = false;
  await assert.rejects(attachTerrainToPlan(input, { ...options, terrainSampleSpacing: 5 }, async points => { called = true; return points.map(() => 0); }), /超过 50000/);
  assert.equal(called, false);
});

test('the unique-point cap also applies across multiple individually acceptable legs', async () => {
  const input = fixture(
    [[[0, 0], [90000, 0]], [[90000, 10], [0, 10]], [[0, 20], [90000, 20]]],
    [[[90000, 0], [90000, 10]], [[0, 10], [0, 20]]],
  );
  let called = false;
  await assert.rejects(attachTerrainToPlan(input, { ...options, terrainSampleSpacing: 5 }, async points => { called = true; return points.map(() => 0); }), /超过 50000/);
  assert.equal(called, false);
});

test('long oblique-coordinate routes are interpolated in the original metric projection', async () => {
  const input = fixture([[[10000, 10000], [-10000, 10000]]]);
  const actual = await attachTerrainToPlan(input, { ...options, terrainSampleSpacing: 100 }, async points => points.map(() => 250), metadata);
  for (const p of actual.legs[0].positions) {
    const xy = frame.forward(p.slice(0, 2));
    close(xy[1], 10000);
    assert.ok(xy[0] >= -10000.00001 && xy[0] <= 10000.00001);
  }
});

test('invalid spacing and disconnected mission structures fail before terrain sampling', async () => {
  const input = fixture([[[0, 0], [100, 0]]]);
  for (const terrainSampleSpacing of [0, 4, 101, NaN, '30']) await assert.rejects(attachTerrainToPlan(input, { ...options, terrainSampleSpacing }, async () => []), /采样间距/);
  await assert.rejects(attachTerrainToPlan({ ...input, connections: [{ positions: [] }] }, options, async () => []), /连续/);
  await assert.rejects(attachTerrainToPlan(input, options, undefined), /地形采样服务/);
});
