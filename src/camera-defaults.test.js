import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_PROFILES, DEFAULT_OPTIONS, DOCK3_OVERLAP_DEFAULTS, applyCameraPreset, createLocalProjection, planMission, validateOptions } from './planner.js';

const projection = createLocalProjection([[116.39, 39.9]]);
const ring = [[0, 0], [600, 0], [600, 500], [0, 500]].map(projection.inverse);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('new missions use Dock 3 documented 80% forward and 70% side overlap defaults', () => {
  assert.deepEqual(DOCK3_OVERLAP_DEFAULTS, { frontOverlap: 80, sideOverlap: 70 });
  assert.equal(DEFAULT_OPTIONS.frontOverlap, 80);
  assert.equal(DEFAULT_OPTIONS.sideOverlap, 70);
  for (const camera of Object.keys(CAMERA_PROFILES)) {
    const options = validateOptions({ camera });
    assert.equal(options.frontOverlap, 80);
    assert.equal(options.sideOverlap, 70);
    const plan = planMission(ring, { camera, autoHeading: false, heading: 90 });
    close(plan.stats.lineSpacingM, plan.stats.footprintWidthM * 0.3);
    close(plan.stats.shotSpacingM, plan.stats.footprintLengthM * 0.2);
  }
});

test('each camera selection resets only camera and overlaps without mutating prior options', () => {
  const before = Object.freeze({
    ...DEFAULT_OPTIONS, camera: '4TD48', frontOverlap: 92, sideOverlap: 86,
    altitude: 145, speed: 4, captureMode: 'smartOrtho', sideTiltDeg: 22.5,
    qualityCutoffDeg: 50, captureCycleSeconds: 2.8, crossGrid: true,
    autoHeading: false, heading: 55, terrainSampleSpacing: 20,
  });
  for (const camera of Object.keys(CAMERA_PROFILES)) {
    const selected = applyCameraPreset(before, camera);
    assert.deepEqual(selected, { ...before, camera, frontOverlap: 80, sideOverlap: 70 });
    assert.notEqual(selected, before);
    assert.equal(before.frontOverlap, 92);
    assert.equal(before.sideOverlap, 86);
  }
  for (const camera of ['unknown', '__proto__', null, 4]) assert.throws(() => applyCameraPreset(before, camera), /相机/);
});

test('manual overlap values survive draft import validation and ordinary recalculation', () => {
  for (const camera of Object.keys(CAMERA_PROFILES)) {
    const manual = { ...applyCameraPreset(DEFAULT_OPTIONS, camera), frontOverlap: 87, sideOverlap: 82 };
    const imported = validateOptions(JSON.parse(JSON.stringify(manual)));
    assert.equal(imported.frontOverlap, 87);
    assert.equal(imported.sideOverlap, 82);
    const changedHeight = validateOptions({ ...imported, altitude: 135 });
    assert.equal(changedHeight.frontOverlap, 87);
    assert.equal(changedHeight.sideOverlap, 82);
    for (const captureMode of ['nadir', 'smartOrtho']) {
      const plan = planMission(ring, { ...changedHeight, captureMode, autoHeading: false, heading: 90 });
      close(plan.stats.lineSpacingM, plan.stats.effectiveSwathWidthM * 0.18);
      close(plan.stats.shotSpacingM, plan.stats.footprintLengthM * 0.13);
    }
  }
});

test('resetting a camera preset changes route and photo spacing for both capture modes', () => {
  for (const captureMode of ['nadir', 'smartOrtho']) {
    const custom = { ...DEFAULT_OPTIONS, camera: '4TD12', captureMode, autoHeading: false, heading: 90, frontOverlap: 90, sideOverlap: 85 };
    const before = planMission(ring, custom);
    // 12 MP and 48 MP share the same FOV: changes here result from overlap reset.
    const after = planMission(ring, applyCameraPreset(custom, '4TD48'));
    close(after.stats.lineSpacingM, before.stats.lineSpacingM * 2);
    close(after.stats.shotSpacingM, before.stats.shotSpacingM * 2);
    assert.ok(after.stats.legCount < before.stats.legCount);
    assert.ok(after.stats.stationCount < before.stats.stationCount);
    assert.notDeepEqual(after.path, before.path);
  }
});
