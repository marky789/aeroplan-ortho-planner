import test from 'node:test';
import assert from 'node:assert/strict';
import { measureBoundary, formatDistance } from './boundary-measurement.js';

const close = (actual, expected, tolerance = 1e-6) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `Expected ${actual} to be within ${tolerance} of ${expected}`,
);
const rectangle = [[0, 0], [1, 0], [1, 1], [0, 1]];

test('equatorial distance matches the GRS80 semi-major axis and uses surface midpoint', () => {
  const result = measureBoundary([[0, 0], [1, 0]]);
  const expected = 6378137 * Math.PI / 180;
  assert.equal(result.segments.length, 1);
  close(result.perimeterM, expected);
  close(result.confirmedLengthM, expected);
  close(result.segments[0].midpoint[0], 0.5, 1e-10);
  close(result.segments[0].midpoint[1], 0, 1e-10);
  assert.equal(result.segments[0].kind, 'confirmed');
});

test('closed rectangle matches independently tabulated GRS80 one-degree geodesics', () => {
  // Equatorial east edge, two meridian arcs, and the geodesic across latitude 1°.
  const expected = 111319.49079327357 + 2 * 110574.38855415255 + 111302.6493394317;
  const result = measureBoundary(rectangle, { closed: true });
  close(result.perimeterM, expected, 0.001);
  close(result.confirmedLengthM, expected, 0.001);
  assert.equal(result.segments.length, 4);
  assert.ok(result.segments.every(edge => edge.kind === 'confirmed'));
});

test('hover preview becomes a confirmed edge without changing the visible perimeter', () => {
  const firstTwo = rectangle.slice(0, 2);
  const preview = measureBoundary(firstTwo, { hover: rectangle[2] });
  const clicked = measureBoundary(rectangle.slice(0, 3));
  const finished = measureBoundary(rectangle.slice(0, 3), { closed: true });
  assert.deepEqual(preview.segments.map(edge => edge.kind), ['confirmed', 'preview', 'closing']);
  assert.deepEqual(clicked.segments.map(edge => edge.kind), ['confirmed', 'confirmed', 'closing']);
  close(preview.perimeterM, clicked.perimeterM);
  close(clicked.perimeterM, finished.perimeterM);
  close(preview.confirmedLengthM, measureBoundary(firstTwo).confirmedLengthM);
  close(finished.confirmedLengthM, finished.perimeterM);
  // Undo restores exactly the same two-point state: no duplicate closing edge.
  assert.deepEqual(measureBoundary(rectangle.slice(0, 3).slice(0, -1)), measureBoundary(firstTwo));
});

test('empty, one-point, repeated and near-repeated points remain finite without duplicate edges', () => {
  assert.deepEqual(measureBoundary([]), { segments: [], confirmedLengthM: 0, perimeterM: 0 });
  assert.deepEqual(measureBoundary([[0, 0], [0, 0], [0.00000001, 0]], { closed: true }),
    { segments: [], confirmedLengthM: 0, perimeterM: 0 });
  assert.equal(measureBoundary([[0, 0]], { hover: [1, 0] }).segments.length, 1);
  assert.equal(measureBoundary([[0, 0], [1, 0]], { hover: [0, 0] }).segments.length, 1);
  assert.equal(measureBoundary([[0, 0], [1, 0]], { closed: true }).segments.length, 1);
  assert.deepEqual(measureBoundary([...rectangle, rectangle[0]], { closed: true }),
    measureBoundary(rectangle, { closed: true }));
  assert.deepEqual(measureBoundary(rectangle, { hover: rectangle.at(-1) }), measureBoundary(rectangle));
  assert.deepEqual(measureBoundary([rectangle[0], rectangle[1], rectangle[0], ...rectangle.slice(2)], { closed: true }),
    measureBoundary(rectangle, { closed: true }));
});

test('hover over an earlier vertex follows the visible path and closes only once at the first vertex', () => {
  const firstThree = rectangle.slice(0, 3);
  const hoverMiddle = measureBoundary(firstThree, { hover: firstThree[1] });
  assert.deepEqual(hoverMiddle.segments.map(edge => edge.kind), ['confirmed', 'confirmed', 'preview', 'closing']);
  assert.deepEqual(hoverMiddle.segments[2].start, firstThree[2]);
  assert.deepEqual(hoverMiddle.segments[2].end, firstThree[1]);
  assert.deepEqual(hoverMiddle.segments[3].start, firstThree[1]);
  assert.deepEqual(hoverMiddle.segments[3].end, firstThree[0]);
  close(hoverMiddle.perimeterM, 2 * hoverMiddle.confirmedLengthM);

  const hoverFirst = measureBoundary(firstThree, { hover: firstThree[0] });
  assert.deepEqual(hoverFirst.segments.map(edge => edge.kind), ['confirmed', 'confirmed', 'preview']);
  assert.deepEqual(hoverFirst.segments.at(-1).end, firstThree[0]);
  close(hoverFirst.perimeterM, measureBoundary(firstThree, { closed: true }).perimeterM);
  close(hoverFirst.confirmedLengthM, measureBoundary(firstThree).confirmedLengthM);
  assert.equal(measureBoundary(firstThree.slice(0, 2), { hover: firstThree[0] }).segments.length, 1);
});

test('distance and geodesic midpoint are direction symmetric and ignore all heights', () => {
  const a = [116.391, 39.907], b = [116.405, 39.912];
  const forward = measureBoundary([a, b]).segments[0];
  const reverse = measureBoundary([b, a]).segments[0];
  close(forward.distanceM, reverse.distanceM);
  close(forward.midpoint[0], reverse.midpoint[0], 1e-9);
  close(forward.midpoint[1], reverse.midpoint[1], 1e-9);
  close(measureBoundary([a, forward.midpoint]).perimeterM, forward.distanceM / 2, 0.00001);
  assert.deepEqual(measureBoundary([[...a, 10000], [...b, -300]]), measureBoundary([a, b]));
  const dateline = measureBoundary([[179.999, 0], [-179.999, 0]]).segments[0];
  close(dateline.distanceM, 6378137 * Math.PI / 180 * 0.002, 0.00001);
  close(Math.abs(dateline.midpoint[0]), 180, 1e-9);
});

test('invalid coordinates and nonconvergent antipodal geodesics report readable errors', () => {
  for (const invalid of [[NaN, 0], [0, Infinity], ['116', 39], [181, 0], [0, -91], [1], null]) {
    assert.throws(() => measureBoundary([invalid]), /有效的经纬度/);
    assert.throws(() => measureBoundary([[0, 0]], { hover: invalid === null ? false : invalid }), /有效的经纬度/);
  }
  assert.throws(() => measureBoundary(null), /经纬度数组/);
  assert.throws(() => measureBoundary([[0, 0], [180, 0]]), /距离过远/);
});

test('distance labels switch units at 1 km with consistent precision', () => {
  assert.equal(formatDistance(0), '0.0 m');
  assert.equal(formatDistance(123.456), '123.5 m');
  assert.equal(formatDistance(999.9), '999.9 m');
  assert.equal(formatDistance(1000), '1.00 km');
  assert.equal(formatDistance(12345.6), '12.35 km');
  for (const invalid of [NaN, Infinity, -1, '10']) assert.throws(() => formatDistance(invalid), /非负数值/);
});
