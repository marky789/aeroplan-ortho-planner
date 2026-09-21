import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalProjection, planMission } from '../src/planner.js';
import { attachTerrainToPlan } from '../src/terrain-route.js';

test('Word reference worked example remains reproducible', () => {
  const frame = createLocalProjection([[116.39, 39.9]]);
  const ring = [[0, 0], [300, 0], [300, 200], [0, 200]].map(frame.inverse);
  const plan = planMission(ring, { autoHeading: false, heading: 90, frontOverlap: 85, sideOverlap: 80 });
  assert.equal(plan.heading, 90);
  assert.equal(plan.stats.legCount, 7);
  assert.equal(plan.stats.photoCount, 140);
  assert.equal(plan.stats.coverageAddedRows, 0);
  assert.equal(plan.connections.length, 6);
  assert.ok(plan.legs.every(leg => leg.photos.length === 20));
  for (const [key, expected, tolerance] of [
    ['areaM2', 60000, 0.01],
    ['gsdCm', 2.729489, 0.000001],
    ['lineSpacingM', 28.823407, 0.000001],
    ['shotSpacingM', 16.196790, 0.000001],
    ['distanceM', 2271.433605, 0.001],
    ['durationSeconds', 396.572268, 0.001],
  ]) assert.ok(Math.abs(plan.stats[key] - expected) < tolerance, key);
});

test('Word reference flat height and analytical slope examples remain reproducible', async()=>{
  const frame=createLocalProjection([[116.39,39.9]]);
  const ring=[[0,0],[300,0],[300,200],[0,200]].map(frame.inverse);
  // The existing Word reference is intentionally unchanged; its flat-height
  // distance/time example uses the original nadir scan grid.
  const options={autoHeading:false,heading:90,captureMode:'nadir',frontOverlap:85,sideOverlap:80};
  const horizontal=planMission(ring,options);
  const flat=await attachTerrainToPlan(horizontal,options,async p=>p.map(()=>50),{source:'test',verticalDatum:'source-orthometric'});
  assert.equal(flat.stats.photoCount,140);
  assert.ok(flat.path.every(p=>p[2]===150));
  assert.ok(Math.abs(flat.stats.durationSeconds-396.572268)<0.001);
  const photos=[[0,0],[100,0]].map(frame.inverse);
  const slope=await attachTerrainToPlan({projectionOrigin:[116.39,39.9],legs:[{start:photos[0],end:photos[1],photos}],connections:[],stats:{}},
    {altitude:100,speed:6},async p=>p.map(ll=>frame.forward(ll)[0]/2),{source:'test',verticalDatum:'source-orthometric'});
  assert.ok(Math.abs(slope.stats.distanceM-111.803399)<0.00001);
  assert.ok(Math.abs(slope.stats.durationSeconds-18.633900)<0.00001);
  assert.ok(Math.abs(slope.stats.maxRequiredClimbRateMps-2.683282)<0.00001);
});
