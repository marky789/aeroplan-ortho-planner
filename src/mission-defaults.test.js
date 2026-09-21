import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_MAP_VIEW, createSampleMission } from './mission-defaults.js';
import { planMission, validatePolygon } from './planner.js';

test('the initial view and plannable example are both in Ningbo city centre', () => {
  const mission = createSampleMission();
  assert.match(mission.name, /宁波/);
  assert.ok(INITIAL_MAP_VIEW.longitude > 121.5 && INITIAL_MAP_VIEW.longitude < 121.6);
  assert.ok(INITIAL_MAP_VIEW.latitude > 29.8 && INITIAL_MAP_VIEW.latitude < 29.9);
  assert.ok(INITIAL_MAP_VIEW.height >= 2000 && INITIAL_MAP_VIEW.height <= 10000);
  for (const [longitude, latitude] of [...mission.ring, mission.dock]) {
    assert.ok(Math.abs(longitude - INITIAL_MAP_VIEW.longitude) < 0.005);
    assert.ok(Math.abs(latitude - INITIAL_MAP_VIEW.latitude) < 0.005);
  }
  assert.equal(validatePolygon(mission.ring, mission.holes).valid, true);
  const plan = planMission(mission.ring, mission.options, mission.holes);
  assert.ok(plan.stats.legCount > 0);
  assert.ok(plan.stats.stationCount > 0);
});

test('loading the Ningbo example creates independent geometry and settings', () => {
  const edited = createSampleMission(), original = createSampleMission();
  edited.ring[0][0] = 113;
  edited.ring.pop();
  edited.holes.push([[1, 1]]);
  edited.dock[0] = 113;
  edited.options.frontOverlap = 95;
  assert.deepEqual(createSampleMission(), original);
});
