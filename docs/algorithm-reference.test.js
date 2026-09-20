import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalProjection, planMission } from '../src/planner.js';

test('Word reference worked example remains reproducible', () => {
  const frame = createLocalProjection([[116.39, 39.9]]);
  const ring = [[0, 0], [300, 0], [300, 200], [0, 200]].map(frame.inverse);
  const plan = planMission(ring, { autoHeading: false, heading: 90 });
  assert.equal(plan.heading, 90);
  assert.equal(plan.stats.legCount, 12);
  assert.equal(plan.stats.photoCount, 384);
  assert.equal(plan.stats.coverageAddedRows, 0);
  assert.equal(plan.connections.length, 11);
  assert.ok(plan.legs.every(leg => leg.photos.length === 32));
  for (const [key, expected, tolerance] of [
    ['areaM2', 60000, 0.01],
    ['gsdCm', 2.729489, 0.000001],
    ['roofGsdCm', 1.637694, 0.000001],
    ['lineSpacingM', 17.294044, 0.000001],
    ['shotSpacingM', 9.718074, 0.000001],
    ['distanceM', 3783.338707, 0.001],
    ['durationSeconds', 663.556451, 0.001],
  ]) assert.ok(Math.abs(plan.stats[key] - expected) < tolerance, key);
});
