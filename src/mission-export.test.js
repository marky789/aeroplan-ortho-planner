import test from 'node:test';
import assert from 'node:assert/strict';
import { exportMission, exportStationsCsv } from './mission-export.js';

const state = { options: { altitude: 100 }, name: 'test', ring: [], holes: [], dock: null };
const plan = { terrain: { status: 'ready', verticalDatum: 'source-orthometric' }, captureMode: 'smartOrtho', photos: [[113,22,143.25]] };
test('version 2 exports keep ground, absolute and AGL heights distinct', () => {
  const data = exportMission(state, plan);
  assert.equal(data.version, 2);
  assert.equal(data.heightReference.ellipsoidConversionApplied, false);
  assert.equal(data.plan.photos[0][2], 143.25);
  const csv = exportStationsCsv(state, plan);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"43.250","143.250","100","smartOrtho","3","source-orthometric"/);
});
test('exports reject pending, absent datum and unavailable elevation', () => {
  for (const invalid of [{ ...plan, terrain:{status:'pending'} }, { ...plan, terrain:{status:'ready'} }, { ...plan, photos:[[113,22]] }]) {
    assert.throws(() => exportMission(state, invalid), /不能导出/);
    assert.throws(() => exportStationsCsv(state, invalid), /不能导出/);
  }
});
