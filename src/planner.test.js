import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_PROFILES, DEFAULT_OPTIONS, createLocalProjection, planMission, validatePolygon } from './planner.js';

const origin = [116.39, 39.9];
const frame = createLocalProjection([origin]);
const ll = points => points.map(frame.inverse);
const rectangle = [[0, 0], [300, 0], [300, 200], [0, 200]];
const baseOptions = { ...DEFAULT_OPTIONS, autoHeading: false, heading: 90 };
const length = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pointInOrOnRing(p, ring) {
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(cross) < 0.002 * Math.max(1, length(a, b)) && p[0] >= Math.min(a[0], b[0]) - 0.002 && p[0] <= Math.max(a[0], b[0]) + 0.002 && p[1] >= Math.min(a[1], b[1]) - 0.002 && p[1] <= Math.max(a[1], b[1]) + 0.002) return 0;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1])) inside = !inside;
  }
  return inside ? 1 : -1;
}

function assertRouteInside(plan, boundary, holes = []) {
  const segments = plan.legs.map(leg => [leg.start, leg.end]);
  for (const connection of plan.connections) {
    for (let i = 1; i < connection.positions.length; i++) segments.push([connection.positions[i - 1], connection.positions[i]]);
  }
  for (const pair of segments) {
    const [a, b] = pair.map(frame.forward);
    for (let i = 0; i <= 50; i++) {
      const p = [a[0] + (b[0] - a[0]) * i / 50, a[1] + (b[1] - a[1]) * i / 50];
      assert.ok(pointInOrOnRing(p, boundary) >= 0, `Route outside boundary at ${p}`);
      for (const hole of holes) assert.ok(pointInOrOnRing(p, hole) <= 0, `Route crosses hole at ${p}`);
    }
  }
}

test('CGCS2000 local projection round trips without changing coordinates', () => {
  const projection = createLocalProjection(ll(rectangle));
  for (const coordinate of [[116.39051, 39.90123], [116.39, 39.9], [116.42, 39.88]]) {
    const actual = projection.inverse(projection.forward(coordinate));
    assert.ok(Math.abs(actual[0] - coordinate[0]) < 1e-8);
    assert.ok(Math.abs(actual[1] - coordinate[1]) < 1e-8);
  }
});

test('rectangle creates a connected survey, full photos and consistent metrics', () => {
  const plan = planMission(ll(rectangle), baseOptions);
  assert.ok(Math.abs(plan.stats.areaM2 - 60000) < 0.5);
  assert.ok(plan.legs.length > 5);
  assert.equal(plan.connections.length, plan.legs.length - 1);
  assert.equal(plan.photos.length, plan.stats.photoCount);
  assert.equal(plan.heading, 90);
  assert.ok(Math.abs(plan.stats.distanceM - plan.stats.captureDistanceM - plan.stats.transitDistanceM) < 1e-6);
  assert.equal(plan.stats.aglM, 100);
  assert.equal(plan.terrain.status, 'pending');
  for (const leg of plan.legs) {
    assert.deepEqual(leg.photos[0], leg.start);
    assert.deepEqual(leg.photos.at(-1), leg.end);
    for (let i = 1; i < leg.photos.length; i++) {
      assert.ok(length(frame.forward(leg.photos[i - 1]), frame.forward(leg.photos[i])) <= plan.stats.shotSpacingM + 0.002);
    }
  }
  assertRouteInside(plan, rectangle);
});

test('concave U keeps every scan intersection and routes around the notch', () => {
  const u = [[0, 0], [300, 0], [300, 240], [210, 240], [210, 90], [90, 90], [90, 240], [0, 240]];
  const plan = planMission(ll(u), baseOptions);
  const upper = plan.legs.filter(leg => frame.forward(leg.start)[1] > 100);
  assert.ok(upper.some(leg => frame.forward(leg.start)[0] < 100));
  assert.ok(upper.some(leg => frame.forward(leg.start)[0] > 200));
  assert.ok(plan.connections.some(connection => connection.positions.length > 2));
  assertRouteInside(plan, u);
});

test('hole is excluded from capture and every connection goes around it', () => {
  const hole = [[110, 55], [190, 55], [190, 150], [110, 150]];
  const plan = planMission(ll(rectangle), baseOptions, [ll(hole)]);
  assert.ok(Math.abs(plan.stats.areaM2 - (60000 - 7600)) < 0.5);
  assert.ok(plan.connections.some(connection => connection.positions.length > 2));
  assertRouteInside(plan, rectangle, [hole]);
});

test('self crossing and touching/nested holes are rejected with actionable errors', () => {
  const bow = ll([[0, 0], [100, 100], [0, 100], [100, 0]]);
  assert.equal(validatePolygon(bow).valid, false);
  assert.throws(() => planMission(bow), /自交/);
  const outside = ll([[290, 20], [330, 20], [330, 60], [290, 60]]);
  assert.equal(validatePolygon(ll(rectangle), [outside]).valid, false);
  const hole = ll([[80, 40], [160, 40], [160, 140], [80, 140]]);
  const nested = ll([[90, 60], [120, 60], [120, 100], [90, 100]]);
  assert.throws(() => planMission(ll(rectangle), baseOptions, [hole, nested]), /包含/);
});

test('only AGL drives spacing and legacy building or dock heights have no effect', () => {
  const ground = planMission(ll(rectangle), { ...baseOptions, buildingHeight: 0 });
  const rooftop = planMission(ll(rectangle), { ...baseOptions, buildingHeight: 50 });
  assert.equal(ground.stats.lineSpacingM, rooftop.stats.lineSpacingM);
  assert.equal(ground.stats.shotSpacingM, rooftop.stats.shotSpacingM);
  assert.equal(ground.stats.gsdCm, rooftop.stats.gsdCm);
  assert.equal(rooftop.stats.minClearanceM, undefined);
  assert.deepEqual(rooftop.path, ground.path);
  const high=planMission(ll(rectangle), {...baseOptions,altitude:200,buildingHeight:500,dockHeight:500});
  assert.equal(high.stats.lineSpacingM,2*ground.stats.lineSpacingM);
  assert.equal(high.stats.gsdCm,2*ground.stats.gsdCm);
});

test('one narrow area still receives a leg and both endpoint exposures', () => {
  const narrow = [[0, 0], [2, 0], [2, 100], [0, 100]];
  const plan = planMission(ll(narrow), { ...baseOptions, heading: 0 });
  assert.equal(plan.legs.length, 1);
  assert.ok(plan.legs[0].photos.length >= 2);
  assertRouteInside(plan, narrow);
});

test('cross grid adds the orthogonal pass and joins it within the polygon', () => {
  const one = planMission(ll(rectangle), baseOptions);
  const two = planMission(ll(rectangle), { ...baseOptions, crossGrid: true });
  assert.ok(two.legs.some(leg => leg.pass === 1));
  assert.ok(two.legs.some(leg => leg.pass === 2));
  assert.ok(two.stats.photoCount > one.stats.photoCount);
  assertRouteInside(two, rectangle);
});

test('auto heading returns a valid coarse candidate; camera modes change resolution', () => {
  const auto = planMission(ll(rectangle), { autoHeading: true });
  assert.ok(auto.heading >= 0 && auto.heading < 180 && auto.heading % 15 === 0);
  assertRouteInside(auto, rectangle);
  const lower = planMission(ll(rectangle), { ...baseOptions, camera: '4TD12' });
  const higher = planMission(ll(rectangle), { ...baseOptions, camera: '4TD48' });
  assert.equal(CAMERA_PROFILES['4TD48'].width, CAMERA_PROFILES['4TD12'].width * 2);
  assert.equal(lower.stats.gsdCm, higher.stats.gsdCm * 2);
  assert.equal(lower.stats.lineSpacingM, higher.stats.lineSpacingM);
  assert.ok(auto.warnings.some(warning => warning.includes('DSM')));
});

test('limits reject invalid configuration and prevent huge tasks', () => {
  assert.throws(() => planMission(ll(rectangle), { speed: 0 }), /速度/);
  assert.throws(() => planMission(ll(rectangle), { frontOverlap: 100 }), /重叠率/);
  const large = [[0, 0], [8000, 0], [8000, 8000], [0, 8000]];
  assert.throws(() => planMission(ll(large), { altitude: 25, buildingHeight: 0, sideOverlap: 95, frontOverlap: 95 }), /过密|4000|15000/);
});

test('closing duplicate is accepted and input arrays are never mutated', () => {
  const ring = ll(rectangle);
  ring.push([...ring[0]]);
  const before = structuredClone(ring);
  assert.equal(validatePolygon(ring).valid, true);
  planMission(ring, baseOptions);
  assert.deepEqual(ring, before);
});

test('thin lateral protrusion receives supplemental coverage instead of being missed', () => {
  const horn = [[0,0],[200,0],[200,73],[600,73],[600,75],[200,75],[200,200],[0,200]];
  const plan = planMission(ll(horn), baseOptions);
  assert.ok(plan.stats.coverageAddedRows > 0);
  assertRouteInside(plan, horn);
  const halfWidth = plan.stats.lineSpacingM / (1-baseOptions.sideOverlap/100) / 2;
  const halfLength = plan.stats.shotSpacingM / (1-baseOptions.frontOverlap/100) / 2;
  const exposures = plan.photos.map(frame.forward);
  for (let x=0;x<=600;x+=5) {
    assert.ok(exposures.some(p => Math.abs(p[0]-x)<=halfLength+.01 && Math.abs(p[1]-74)<=halfWidth+.01), `Uncovered horn at ${x},74`);
  }
});

test('malformed imported geometry and option values fail without unsafe coercion', () => {
  for (const ring of [null, [], [null,null,null], [[0,0],[1,0],[1,'1']], new Array(4)]) assert.equal(validatePolygon(ring).valid,false);
  for (const options of [{camera:'__proto__'},{camera:'unknown'},{altitude:'100'},{altitude:NaN},{autoHeading:'false'},{crossGrid:1},null,[]]) {
    assert.throws(()=>planMission(ll(rectangle),options));
  }
  const first = ll([[60,40],[140,40],[140,140],[60,140]]);
  const overlapping = ll([[100,60],[180,60],[180,160],[100,160]]);
  assert.equal(validatePolygon(ll(rectangle),[first,overlapping]).valid,false);
});

test('wide combined swaths still fill flat coverage gaps using actual nadir footprints',()=>{
  const boundary=[[0,0],[1000,0],[1000,600],[0,600]];
  const plan=planMission(ll(boundary),{...baseOptions,captureMode:'smartOrtho',sideOverlap:50,sideTiltDeg:25,qualityCutoffDeg:65});
  assert.ok(plan.stats.lineSpacingM>plan.stats.footprintWidthM);
  assert.ok(plan.stats.coverageAddedRows>0,'Sparse equivalent strips must not be treated as solid image rectangles');
  const exposures=plan.photos.map(frame.forward);
  for(let x=0;x<=1000;x+=10)for(let y=0;y<=600;y+=10){
    assert.ok(exposures.some(p=>Math.abs(p[0]-x)<=plan.stats.footprintLengthM/2+.02 && Math.abs(p[1]-y)<=plan.stats.footprintWidthM/2+.02),`Uncovered ground ${x},${y}`);
  }
  assertRouteInside(plan,boundary);
});

test('combined-swath routes preserve concave and hole constraints across both grid directions',()=>{
  const horn=[[0,0],[200,0],[200,73],[600,73],[600,75],[200,75],[200,200],[0,200]];
  const smart={...baseOptions,captureMode:'smartOrtho'};
  const plan=planMission(ll(horn),smart);
  assertRouteInside(plan,horn);
  const exposures=plan.photos.map(frame.forward);
  for(let x=0;x<=600;x+=5)assert.ok(exposures.some(p=>Math.abs(p[0]-x)<=plan.stats.footprintLengthM/2+.02 && Math.abs(p[1]-74)<=plan.stats.footprintWidthM/2+.02));
  const hole=[[110,55],[190,55],[190,150],[110,150]];
  const cross=planMission(ll(rectangle),{...smart,crossGrid:true},[ll(hole)]);
  assert.ok(cross.legs.some(leg=>leg.pass===2));
  assertRouteInside(cross,rectangle,[hole]);
});
