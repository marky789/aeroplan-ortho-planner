import test from 'node:test';
import assert from 'node:assert/strict';
import { footprintOffsets, createCaptureModel } from './capture-geometry.js';
import { CAMERA_PROFILES, DEFAULT_OPTIONS, createLocalProjection, planMission } from './planner.js';
test('nadir rays reproduce calibrated FOV rectangle and altitude scaling',()=>{
  const cam=CAMERA_PROFILES['4D'], a=footprintOffsets(cam,100,-90,0), b=footprintOffsets(cam,200,-90,0);
  const scale=2*Math.tan(42*Math.PI/180)/Math.hypot(cam.width,cam.height);
  assert.ok(Math.abs(a.areaM2-(100*scale)**2*cam.width*cam.height)<1e-6);
  assert.ok(Math.abs(b.areaM2/a.areaM2-4)<1e-10);
});
test('user side yaw produces mirrored oblique footprints and explicit zero roll',()=>{
  const m=createCaptureModel(CAMERA_PROFILES['4D'],{...DEFAULT_OPTIONS,captureMode:'smartOrtho'});
  const [l,n,r]=m.views;
  assert.equal(l.pitch,-62.5);assert.equal(l.yawOffset,-27.5);assert.equal(r.yawOffset,27.5);
  assert.ok(m.views.every(v=>v.roll===0));assert.equal(m.nativeTiming,null);
  assert.ok(Math.abs(l.areaM2-r.areaM2)<1e-6);assert.ok(l.areaM2>n.areaM2);
  for(const p of l.corners)assert.ok(r.corners.some(q=>Math.hypot(p[0]+q[0],p[1]-q[1])<1e-8));
});
test('three-direction planning restricts model, keeps coverage and budgets exposures',()=>{
  const f=createLocalProjection([[116.39,39.9]]), ring=[[0,0],[300,0],[300,200],[0,200]].map(f.inverse);
  const a=planMission(ring,{autoHeading:false,heading:90}),b=planMission(ring,{autoHeading:false,heading:90,captureMode:'smartOrtho'});
  assert.deepEqual(a.path,b.path);assert.equal(b.stats.photoCount,a.stats.photoCount*3);
  assert.equal(b.captureRequests.length,b.stats.stationCount);
  assert.equal(b.captureModel.views[0].pitch,-62.5);
  assert.ok(b.captureRequests.some(r=>r.flightHeadingDeg>260));
  for(const options of [{captureMode:'smartOrtho',camera:'4TD12'},{smartPitch:-10},{smartYaw:45}])assert.throws(()=>planMission(ring,options));
});
