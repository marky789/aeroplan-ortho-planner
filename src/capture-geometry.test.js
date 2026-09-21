import test from 'node:test';
import assert from 'node:assert/strict';
import { footprintOffsets, createCaptureModel, combinedCrossTrackSwath } from './capture-geometry.js';
import { CAMERA_PROFILES, DEFAULT_OPTIONS, createLocalProjection, planMission } from './planner.js';

const rad = Math.PI / 180;
const camera = CAMERA_PROFILES['4TD48'];
const alphaH = Math.atan(0.8 * Math.tan(41 * rad));
const alphaV = Math.atan(0.6 * Math.tan(41 * rad));
const close = (actual, expected, tolerance = 1e-8) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `Expected ${actual} to be within ${tolerance} of ${expected}`,
);
const settings = overrides => ({
  ...DEFAULT_OPTIONS,
  camera: '4TD48', captureMode: 'smartOrtho', altitude: 100,
  sideTiltDeg: 20, qualityCutoffDeg: 45, captureCycleSeconds: null,
  autoHeading: false, heading: 90,
  ...overrides,
});
const projection = createLocalProjection([[116.39, 39.9]]);
const rectangle = (width = 600, height = 500) => [[0, 0], [width, 0], [width, height], [0, height]].map(projection.inverse);

test('nadir rays reproduce the FOV rectangle and quadratic area scaling', () => {
  const a = footprintOffsets(camera, 100), b = footprintOffsets(camera, 200, 0);
  const width = 200 * Math.tan(alphaH), length = 200 * Math.tan(alphaV);
  close(Math.max(...a.corners.map(p => p[0])) - Math.min(...a.corners.map(p => p[0])), width);
  close(Math.max(...a.corners.map(p => p[1])) - Math.min(...a.corners.map(p => p[1])), length);
  close(a.areaM2, width * length);
  close(b.areaM2 / a.areaM2, 4);
});

test('cross-track tilt gives the document near/far edges and mirrored usable footprints', () => {
  const model = createCaptureModel(camera, settings());
  const [left, nadir, right] = model.views;
  assert.deepEqual(model.views.map(view => view.axisTiltDeg), [-20, 0, 20]);
  close(Math.min(...right.corners.map(p => p[0])), 100 * Math.tan(20 * rad - alphaH));
  close(Math.max(...right.corners.map(p => p[0])), 100 * Math.tan(20 * rad + alphaH));
  for (const key of ['corners', 'usableCorners']) {
    for (const p of left[key]) assert.ok(right[key].some(q => Math.hypot(p[0] + q[0], p[1] - q[1]) < 1e-8));
  }
  close(left.areaM2, right.areaM2);
  close(left.usableAreaM2, right.usableAreaM2);
  assert.ok(right.usableAreaM2 < right.areaM2);
  close(nadir.usableAreaM2, nadir.areaM2);
  assert.ok(model.views.every(view => !Object.hasOwn(view, 'pitch') && !Object.hasOwn(view, 'yawOffset') && !Object.hasOwn(view, 'roll')));
  assert.equal(model.poseSource, 'document-cross-track-model');
  assert.equal(model.hardwareSupport, 'unverified');
  assert.equal(model.nativeTiming, null);
  assert.equal(model.executionVerified, false);
});

test('the quality-clipped union matches the supplied document numerical table', () => {
  // Independent numerical references from the document's H=100 m table.
  const cases = [
    [10, 45, 198.71875735674757, 59.61562720702427],
    [15, 45, 200, 60],
    [20, 45, 200, 60],
    [20, 50, 238.350718518842, 71.5052155556526],
    [25, 50, 238.350718518842, 71.5052155556526],
    [25, 55, 285.62960134842285, 85.68888040452686],
  ];
  for (const [sideTiltDeg, qualityCutoffDeg, width, spacing] of cases) {
    const model = createCaptureModel(camera, settings({ sideTiltDeg, qualityCutoffDeg }));
    assert.equal(model.swath.model, 'quality-clipped-cross-track');
    assert.equal(model.swath.continuous, true);
    close(model.swath.widthM, width);
    close(model.swath.widthM * 0.3, spacing);
    close(model.swath.theoreticalWidthM, 200 * Math.tan(sideTiltDeg * rad + alphaH));
    close(model.swath.effectiveEdgeAngleDeg, Math.min(sideTiltDeg + alphaH / rad, qualityCutoffDeg));
    close(model.swath.edgeGsdScale, 1 / Math.cos(model.swath.effectiveEdgeAngleDeg * rad) ** 2);
    assert.equal(model.swath.qualityCutoffDeg, qualityCutoffDeg);
    const clippedUnion = combinedCrossTrackSwath(model.views.map(view => ({ corners: view.usableCorners })));
    close(clippedUnion.widthM, model.swath.widthM);
  }
});

test('quality cutoff saturates the benefit of larger tilt and clips all views at low cutoffs', () => {
  const a = createCaptureModel(camera, settings({ sideTiltDeg: 15 }));
  const b = createCaptureModel(camera, settings({ sideTiltDeg: 25 }));
  close(a.swath.widthM, b.swath.widthM);
  assert.ok(b.swath.theoreticalWidthM > a.swath.theoreticalWidthM);
  const low = createCaptureModel(camera, settings({ qualityCutoffDeg: 20 }));
  const edge = 100 * Math.tan(20 * rad);
  close(low.swath.widthM, 2 * edge);
  assert.ok(low.swath.widthM < 200 * Math.tan(alphaH));
  for (const view of low.views) {
    assert.ok(view.usableCorners.every(p => Math.abs(p[0]) <= edge + 1e-8));
    assert.ok(view.usableAreaM2 < view.areaM2);
  }
});

test('zero side tilt recovers nadir swath; height and reversed direction preserve scale', () => {
  const zero = createCaptureModel(camera, settings({ sideTiltDeg: 0 }));
  close(zero.swath.widthM, 139.08587805059625);
  const base = createCaptureModel(camera, settings());
  const high = createCaptureModel(camera, settings({ altitude: 200 }));
  close(high.swath.widthM, 2 * base.swath.widthM);
  close(high.swath.theoreticalWidthM, 2 * base.swath.theoreticalWidthM);
  close(high.swath.edgeGsdScale, base.swath.edgeGsdScale);
  const reversed = combinedCrossTrackSwath(base.views.map(view => ({ corners: view.usableCorners.map(([x, y]) => [-x, -y]) })));
  close(reversed.widthM, base.swath.widthM);
  assert.equal(reversed.continuous, true);
});

test('three-direction planning uses effective swath but retains nadir along-track station spacing', () => {
  const ring = rectangle();
  const nadir = planMission(ring, settings({ captureMode: 'nadir' }));
  const smart = planMission(ring, settings());
  close(smart.stats.footprintWidthM, 139.08587805059625);
  close(smart.stats.footprintLengthM, 104.3144085379472);
  close(smart.stats.gsdCm, 1.724775273444894);
  close(smart.stats.effectiveSwathWidthM, 200);
  close(smart.stats.theoreticalSwathWidthM, 200 * Math.tan(20 * rad + alphaH));
  close(smart.stats.lineSpacingM, 40);
  close(nadir.stats.lineSpacingM, 27.81717561011925);
  close(smart.stats.shotSpacingM, 15.64716128069208);
  close(smart.stats.shotSpacingM, nadir.stats.shotSpacingM);
  close(smart.stats.edgeGsdScale, 2);
  close(smart.stats.edgeGsdCm, smart.stats.gsdCm * 2);
  assert.notDeepEqual(smart.path, nadir.path);
  assert.ok(smart.stats.legCount < nadir.stats.legCount);
  assert.ok(smart.stats.distanceM < nadir.stats.distanceM);
  assert.equal(smart.stats.photoCount, smart.stats.stationCount * 3);
  assert.equal(smart.captureRequests.length, smart.stats.stationCount);
  assert.ok(smart.captureRequests.every(request => request.directionCount === 3));
  assert.ok(smart.captureRequests.some(request => request.flightHeadingDeg > 260));
});

test('4TD resolution changes GSD without changing swath or routes', () => {
  const ring = rectangle();
  const a = planMission(ring, settings({ camera: '4TD48' }));
  const b = planMission(ring, settings({ camera: '4TD12' }));
  close(b.stats.gsdCm, 2 * a.stats.gsdCm);
  close(b.stats.edgeGsdCm, 2 * a.stats.edgeGsdCm);
  close(b.stats.lineSpacingM, a.stats.lineSpacingM);
  close(b.stats.shotSpacingM, a.stats.shotSpacingM);
  assert.deepEqual(b.path, a.path);
});

test('unmeasured capture cycles remain unverified despite passing the photo interval', () => {
  const plan = planMission(rectangle(), settings({ speed: 6 }));
  close(plan.stats.maxSpeedByPhotoMps, plan.stats.minimumActualStationSpacingM / 0.7);
  close(plan.stats.nominalMaxSpeedByPhotoMps, plan.stats.shotSpacingM / 0.7);
  assert.ok(plan.stats.maxSpeedByPhotoMps <= plan.stats.shotSpacingM / 0.7 + 1e-8);
  assert.equal(plan.stats.maxSpeedByCycleMps, null);
  assert.equal(plan.stats.captureCycleVerified, false);
  assert.equal(plan.stats.captureCycleSatisfied, null);
  assert.equal(plan.stats.photoIntervalSatisfied, true);
  assert.equal(plan.stats.speedConstraintsSatisfied, null);
});

test('measured cycle limits velocity and failure remains explicit', () => {
  const ring = rectangle();
  const pass = planMission(ring, settings({ speed: 6, captureCycleSeconds: 1 }));
  close(pass.stats.maxSpeedByCycleMps, pass.stats.minimumActualStationSpacingM);
  close(pass.stats.maxSpeedMps, Math.min(pass.stats.maxSpeedByPhotoMps, pass.stats.maxSpeedByCycleMps));
  assert.equal(pass.stats.captureCycleVerified, true);
  assert.equal(pass.stats.captureCycleSatisfied, true);
  assert.equal(pass.stats.speedConstraintsSatisfied, true);
  const fail = planMission(ring, settings({ speed: 6, captureCycleSeconds: 4 }));
  close(fail.stats.maxSpeedByCycleMps, fail.stats.minimumActualStationSpacingM / 4);
  assert.equal(fail.stats.photoIntervalSatisfied, true);
  assert.equal(fail.stats.captureCycleVerified, false);
  assert.equal(fail.stats.captureCycleSatisfied, false);
  assert.equal(fail.stats.speedConstraintsSatisfied, false);
});

test('velocity checks use the actual short station separation, not only the nominal formula', () => {
  const plan = planMission(rectangle(5, 100), settings({ speed: 10, captureCycleSeconds: 0.8 }));
  close(plan.stats.minimumActualStationSpacingM, 5, 1e-5);
  assert.ok(plan.stats.shotSpacingM / 0.7 > 10);
  assert.ok(plan.stats.maxSpeedByPhotoMps < 10);
  assert.equal(plan.stats.photoIntervalSatisfied, false);
  assert.equal(plan.stats.captureCycleSatisfied, false);
  assert.equal(plan.stats.speedConstraintsSatisfied, false);
});

test('invalid quality/tilt/cycle inputs and non-finite geometry are rejected', () => {
  const ring = rectangle();
  for (const overrides of [
    { sideTiltDeg: -1 }, { sideTiltDeg: NaN }, { sideTiltDeg: Infinity },
    { qualityCutoffDeg: 0 }, { qualityCutoffDeg: -1 }, { qualityCutoffDeg: 90 }, { qualityCutoffDeg: NaN },
    { captureCycleSeconds: 0 }, { captureCycleSeconds: -1 }, { captureCycleSeconds: Infinity }, { captureCycleSeconds: '2' },
  ]) assert.throws(() => planMission(ring, settings(overrides)), `Expected rejection for ${JSON.stringify(overrides)}`);
  assert.throws(() => createCaptureModel(camera, settings({ sideTiltDeg: 56 })), /地平线|90|有限/);
  const narrowCamera = { ...camera, diagonalFov: 30 };
  assert.throws(() => createCaptureModel(narrowCamera, settings({ sideTiltDeg: 30 })), /连续|间隙|空洞/);
  for (const altitude of [0, -1, NaN, Infinity]) assert.throws(() => planMission(ring, settings({ altitude })));
});

test('obsolete pitch and yaw settings cannot alter the document model', () => {
  const ring = rectangle();
  const base = planMission(ring, settings());
  const obsolete = planMission(ring, settings({ smartPitch: -10, smartYaw: 80 }));
  assert.deepEqual(obsolete.path, base.path);
  assert.deepEqual(obsolete.captureModel, base.captureModel);
  close(obsolete.stats.lineSpacingM, base.stats.lineSpacingM);
});

test('projected union counts overlap once and exposes genuine cross-track gaps', () => {
  const view = (a, b) => ({ corners: [[a, 0], [b, 0], [b, 1], [a, 1]] });
  const overlap = combinedCrossTrackSwath([view(5, 10), view(-10, 0), view(-5, 7)]);
  assert.deepEqual(overlap.intervalsM, [[-10, 10]]);
  assert.equal(overlap.widthM, 20);
  assert.equal(overlap.continuous, true);
  const gaps = combinedCrossTrackSwath([view(-10, -5), view(5, 10)]);
  assert.deepEqual(gaps.intervalsM, [[-10, -5], [5, 10]]);
  assert.equal(gaps.widthM, 10);
  assert.equal(gaps.continuous, false);
  assert.throws(() => combinedCrossTrackSwath([]));
  assert.throws(() => combinedCrossTrackSwath([{ corners: [[0, 0], [1, NaN], [2, 0]] }]));
});
