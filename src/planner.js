import proj4 from 'proj4';
import { createCaptureModel } from './capture-geometry.js';

// The image footprint is an approximation from the advertised diagonal FOV.
// A calibrated lens model is needed before executing a production survey.
// JPEG photo modes / minimum intervals: https://enterprise.dji.com/dock-3/specs
export const CAMERA_PROFILES = Object.freeze({
  '4D': { name: 'Matrice 4D · 20 MP', width: 5280, height: 3956, diagonalFov: 84, minInterval: 0.5 },
  '4TD12': { name: 'Matrice 4TD · 12 MP', width: 4032, height: 3024, diagonalFov: 82, minInterval: 0.7 },
  '4TD48': { name: 'Matrice 4TD · 48 MP', width: 8064, height: 6048, diagonalFov: 82, minInterval: 0.7 },
});

export const DEFAULT_OPTIONS = Object.freeze({
  camera: '4D', captureMode: 'nadir', altitude: 100,
  smartPitch: -62.5, smartYaw: 27.5,
  terrainSampleSpacing: 30, frontOverlap: 85, sideOverlap: 80, speed: 6,
  heading: 0, autoHeading: true, crossGrid: false, turnSeconds: 3,
});

const EPS = 1e-6;
const MAX_VERTICES = 180;
const MAX_LEGS = 4000;
const MAX_PHOTOS = 15000;
const GEOGRAPHIC_CGCS2000 = '+proj=longlat +ellps=GRS80 +no_defs';
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const normalizeHeading = angle => ((angle % 180) + 180) % 180;
const edgesOf = ring => ring.map((point, index) => [point, ring[(index + 1) % ring.length]]);
const areaOf = ring => Math.abs(ring.reduce((sum, p, i) => sum + cross(p, ring[(i + 1) % ring.length]), 0)) / 2;

/** Local metric geometry on the CGCS2000 reference ellipsoid. */
export function createLocalProjection(ringLL) {
  if (!Array.isArray(ringLL) || !ringLL.length || Array.from(ringLL).some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) >= 85)) {
    throw new Error('建立局部投影需要有效的经纬度坐标。');
  }
  const center = ringLL.reduce((sum, p) => [sum[0] + p[0] / ringLL.length, sum[1] + p[1] / ringLL.length], [0, 0]);
  const definition = `+proj=aeqd +lat_0=${center[1]} +lon_0=${center[0]} +ellps=GRS80 +units=m +no_defs`;
  const converter = proj4(GEOGRAPHIC_CGCS2000, definition);
  return { origin: center, forward: p => converter.forward(p), inverse: p => converter.inverse(p) };
}

function cleanRing(ring, label) {
  if (!Array.isArray(ring)) throw new Error(`${label}必须是经纬度坐标数组。`);
  const result = Array.from(ring, p => {
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new Error(`${label}包含无效坐标。`);
    }
    if (Math.abs(p[0]) > 180 || Math.abs(p[1]) >= 85) throw new Error(`${label}坐标超出支持范围。`);
    return [p[0], p[1]];
  });
  if (result.length > 1 && dist(result[0], result.at(-1)) < 1e-11) result.pop();
  if (result.length < 3) throw new Error(`${label}至少需要三个不同顶点。`);
  return result;
}

function pointOnSegment(p, a, b) {
  const ab = subtract(b, a);
  return Math.abs(cross(ab, subtract(p, a))) <= EPS * Math.max(1, dist(a, b)) &&
    p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}

// 1 = interior, 0 = boundary, -1 = exterior.
function classifyPoint(p, ring) {
  let inside = false;
  for (const [a, b] of edgesOf(ring)) {
    if (pointOnSegment(p, a, b)) return 0;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 1 : -1;
}

function intersectionParameters(a, b, c, d) {
  const r = subtract(b, a), s = subtract(d, c), ca = subtract(c, a);
  const denom = cross(r, s);
  const scale = Math.max(1, Math.hypot(...r) * Math.hypot(...s));
  if (Math.abs(denom) > 1e-12 * scale) {
    const t = cross(ca, s) / denom, u = cross(ca, r) / denom;
    return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? [Math.max(0, Math.min(1, t))] : [];
  }
  if (Math.abs(cross(ca, r)) > EPS * Math.max(1, Math.hypot(...r))) return [];
  const length2 = r[0] ** 2 + r[1] ** 2;
  if (length2 < EPS ** 2) return pointOnSegment(a, c, d) ? [0] : [];
  const t0 = (ca[0] * r[0] + ca[1] * r[1]) / length2;
  const da = subtract(d, a), t1 = (da[0] * r[0] + da[1] * r[1]) / length2;
  const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
  return hi >= lo - 1e-9 ? [Math.max(0, lo), Math.min(1, hi)] : [];
}

function assertSimple(ring, label) {
  const edges = edgesOf(ring);
  for (let i = 0; i < ring.length; i++) {
    if (dist(...edges[i]) < 0.05) throw new Error(`${label}有重复或过近的相邻顶点。`);
    // Adjacent backtracking edges overlap and do not define a simple polygon.
    const prev = ring[(i + ring.length - 1) % ring.length], current = ring[i], next = ring[(i + 1) % ring.length];
    if (pointOnSegment(next, prev, current) || pointOnSegment(prev, current, next)) throw new Error(`${label}存在重叠边，请重新绘制。`);
    for (let j = i + 1; j < ring.length; j++) {
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      if (intersectionParameters(...edges[i], ...edges[j]).length) throw new Error(`${label}存在自交或相互接触的边，请重新绘制。`);
    }
  }
  if (areaOf(ring) < 1) throw new Error(`${label}面积过小，至少需要 1 平方米。`);
}

function preparePolygon(ringLL, holesLL = []) {
  const ring = cleanRing(ringLL, '作业区域');
  if (!Array.isArray(holesLL)) throw new Error('排除区域必须是多边形数组。');
  const holes = Array.from(holesLL, (hole, i) => cleanRing(hole, `排除区域 ${i + 1}`));
  if (ring.length + holes.reduce((n, h) => n + h.length, 0) > MAX_VERTICES) throw new Error(`顶点总数超过 ${MAX_VERTICES}，请简化边界。`);
  if (Math.max(...ring.map(p => p[0])) - Math.min(...ring.map(p => p[0])) > 5) throw new Error('范围过大或跨越日期变更线，请拆分为本地航测区域。');
  const projection = createLocalProjection(ring);
  const outer = ring.map(projection.forward), inner = holes.map(h => h.map(projection.forward));
  if ([outer, ...inner].some(r => r.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1])))) throw new Error('坐标无法转换到当地米制投影，请检查导入数据的坐标系。');
  const xs = outer.map(p => p[0]), ys = outer.map(p => p[1]);
  if (Math.max(...xs) - Math.min(...xs) > 30000 || Math.max(...ys) - Math.min(...ys) > 30000) throw new Error('单次规划范围跨度超过 30 公里，请拆分作业区域。');
  assertSimple(outer, '作业区域');
  inner.forEach((hole, i) => {
    assertSimple(hole, `排除区域 ${i + 1}`);
    if (classifyPoint(hole[0], outer) !== 1 || edgesOf(hole).some(h => edgesOf(outer).some(e => intersectionParameters(...h, ...e).length))) {
      throw new Error(`排除区域 ${i + 1}必须完全位于作业区域内部，且不能接触外边界。`);
    }
    for (let j = 0; j < i; j++) {
      if (classifyPoint(hole[0], inner[j]) >= 0 || classifyPoint(inner[j][0], hole) >= 0 || edgesOf(hole).some(h => edgesOf(inner[j]).some(e => intersectionParameters(...h, ...e).length))) {
        throw new Error('排除区域不能相交、接触或互相包含。');
      }
    }
  });
  return { projection, outer, holes: inner, rings: [outer, ...inner], areaM2: areaOf(outer) - inner.reduce((sum, h) => sum + areaOf(h), 0) };
}

export function validatePolygon(ringLL, holesLL = []) {
  try {
    const polygon = preparePolygon(ringLL, holesLL);
    return { valid: true, errors: [], areaM2: polygon.areaM2 };
  } catch (error) {
    return { valid: false, error: error.message, errors: [error.message] };
  }
}

export function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('规划参数必须是有效对象。');
  // Old drafts may contain building/dock heights. They no longer affect this
  // terrain-relative model; only supported planning fields are retained.
  const settings = Object.fromEntries(Object.entries(DEFAULT_OPTIONS).map(([key, value]) => [key, Object.hasOwn(options, key) ? options[key] : value]));
  if (typeof settings.camera !== 'string' || !Object.hasOwn(CAMERA_PROFILES, settings.camera)) throw new Error('请选择有效的相机型号与照片模式。');
  if (typeof settings.autoHeading !== 'boolean' || typeof settings.crossGrid !== 'boolean') throw new Error('自动航向与双网格参数必须为布尔值。');
  if (!['nadir', 'smartOrtho'].includes(settings.captureMode)) throw new Error('请选择有效的采集方式。');
  if (settings.captureMode === 'smartOrtho' && settings.camera !== '4D') throw new Error('正射三向智能摆拍仅支持 Matrice 4D。');
  for (const key of ['altitude', 'smartPitch', 'smartYaw', 'terrainSampleSpacing', 'frontOverlap', 'sideOverlap', 'speed', 'heading', 'turnSeconds']) {
    if (!Number.isFinite(settings[key])) throw new Error(`参数 ${key} 必须为有效数值。`);
  }
  if (settings.altitude <= 0 || settings.altitude > 1000) throw new Error('规划航高应在 0–1000 米之间。');
  if (settings.terrainSampleSpacing < 5 || settings.terrainSampleSpacing > 100) throw new Error('地形采样间距应在 5–100 米之间。');
  if(settings.smartPitch < -65 || settings.smartPitch > -60 || settings.smartYaw < 25 || settings.smartYaw > 30) throw new Error('三向侧视俯仰应为 −65° 至 −60°，左右偏航幅度应为 25° 至 30°。');
  if (settings.frontOverlap < 50 || settings.frontOverlap > 95 || settings.sideOverlap < 50 || settings.sideOverlap > 95) throw new Error('航向和旁向重叠率须在 50%–95% 之间。');
  if (settings.speed <= 0 || settings.speed > 25) throw new Error('拍摄速度须大于 0 且不超过 25 米/秒。');
  if (settings.turnSeconds < 0 || settings.turnSeconds > 60) throw new Error('单次转弯预留应在 0–60 秒之间。');
  return settings;
}

function cameraGeometry(settings) {
  const camera = CAMERA_PROFILES[settings.camera];
  const pixelDiagonal = Math.hypot(camera.width, camera.height);
  const scale = 2 * Math.tan(camera.diagonalFov * Math.PI / 360) / pixelDiagonal;
  return {
    gsdCm: settings.altitude * scale * 100,
    footprintWidthM: settings.altitude * scale * camera.width,
    footprintLengthM: settings.altitude * scale * camera.height,
    lineSpacingM: settings.altitude * scale * camera.width * (1 - settings.sideOverlap / 100),
    shotSpacingM: settings.altitude * scale * camera.height * (1 - settings.frontOverlap / 100),
  };
}

function scanFrame(polygon, heading) {
  const angle = heading * Math.PI / 180, sin = Math.sin(angle), cos = Math.cos(angle);
  const rotate = p => [p[0] * sin + p[1] * cos, p[0] * cos - p[1] * sin];
  const unrotate = p => [p[0] * sin + p[1] * cos, p[0] * cos - p[1] * sin];
  const rings = polygon.rings.map(ring => ring.map(rotate));
  const edges = rings.flatMap(edgesOf);
  function intervalsAt(y) {
    const intersections = [];
    for (const [a, b] of edges) {
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) intersections.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    intersections.sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i + 1 < intersections.length; i += 2) if (intersections[i + 1] - intersections[i] > EPS) result.push([intersections[i], intersections[i + 1]]);
    return result;
  }
  const rowAt = (y, pass) => intervalsAt(y).map(([a, b]) => ({ pass, scanY: y, start: unrotate([a, y]), end: unrotate([b, y]) }));
  return { rings, rotate, unrotate, intervalsAt, rowAt };
}

function orderScanRows(legs) {
  const sorted = [...legs].sort((a, b) => a.scanY - b.scanY);
  const result = [];
  let row = -1, previousY = -Infinity, current = [];
  function flush() {
    if (row % 2) { current.reverse(); current.forEach(leg => { [leg.start, leg.end] = [leg.end, leg.start]; }); }
    result.push(...current); current = [];
  }
  for (const leg of sorted) {
    if (Math.abs(leg.scanY - previousY) > EPS) { flush(); row++; previousY = leg.scanY; }
    current.push(leg);
  }
  flush();
  return result;
}

function makeScan(polygon, heading, spacing, pass) {
  const { rings, rowAt } = scanFrame(polygon, heading);
  const ys = rings[0].map(p => p[1]), minY = Math.min(...ys), maxY = Math.max(...ys);
  const count = Math.max(1, Math.ceil((maxY - minY) / spacing));
  if (count > MAX_LEGS) throw new Error('航带过密或范围过大，请提高航高、降低重叠率或分区规划。');
  const legs = [];
  for (let row = 0; row < count; row++) {
    const y = minY + (row + 0.5) * (maxY - minY) / count;
    legs.push(...rowAt(y, pass));
    if (legs.length > MAX_LEGS) throw new Error('航段数量超过 4000，请拆分作业区域。');
  }
  return orderScanRows(legs);
}

// A continuous exposure strip is exactly a rectangle in this flat model:
// endpoint exposures are included, and exposure spacing is <= the footprint.
// Sweep the polygon and rectangle boundaries to detect thin protrusions missed
// by the regular grid. This checks single-image flat coverage, not visibility,
// redundant stereo coverage, or true-ortho reconstruction quality.
function completeFlatCoverage(polygon, heading, initial, geometry, settings, pass) {
  const frame = scanFrame(polygon, heading);
  const halfWidth = geometry.lineSpacingM / (1 - settings.sideOverlap / 100) / 2;
  const halfLength = geometry.shotSpacingM / (1 - settings.frontOverlap / 100) / 2;
  const strips = initial.map(leg => {
    const a = frame.rotate(leg.start), b = frame.rotate(leg.end);
    return { left: Math.min(a[0], b[0]) - halfLength, right: Math.max(a[0], b[0]) + halfLength, low: leg.scanY - halfWidth, high: leg.scanY + halfWidth };
  });
  // Recreate non-oriented pieces so adding rows cannot double-flip old legs.
  const rowValues = [...new Set(initial.map(leg => leg.scanY))];
  const polygonYs = frame.rings.flat().map(p => p[1]), minY = Math.min(...polygonYs), maxY = Math.max(...polygonYs);
  let addedRows = 0;
  function missingAt(y) {
    const coverage = strips.filter(s => s.low <= y + EPS && s.high >= y - EPS).sort((a, b) => a.left - b.left);
    for (const [start, end] of frame.intervalsAt(y)) {
      let cursor = start;
      for (const interval of coverage) {
        if (interval.right < cursor) continue;
        if (interval.left > cursor + EPS) return true;
        cursor = Math.max(cursor, interval.right);
        if (cursor >= end - EPS) break;
      }
      if (cursor < end - EPS) return true;
    }
    return false;
  }
  // Added rectangles introduce new sweep events. A second pass checks those
  // new intervals, repeating until coverage is complete or a bounded limit hits.
  for (let iteration = 0; iteration <= MAX_VERTICES; iteration++) {
    const events = [...polygonYs, ...strips.flatMap(s => [s.low, s.high]).filter(y => y > minY && y < maxY)].sort((a, b) => a - b);
    let changed = false;
    for (let index = 1; index < events.length; index++) {
      const span = events[index] - events[index - 1];
      if (span <= EPS * 2) continue;
      const delta = Math.min(span / 4, EPS * 10);
      for (const y of [(events[index] + events[index - 1]) / 2, events[index - 1] + delta, events[index] - delta]) {
        if (!missingAt(y)) continue;
        const extra = frame.rowAt(y, pass);
        if (!extra.length || rowValues.some(previous => Math.abs(previous - y) < EPS)) throw new Error('极窄区域未能完成平面覆盖，请简化边界或拆分作业区。');
        rowValues.push(y); addedRows++; changed = true;
        for (const leg of extra) {
          const a = frame.rotate(leg.start), b = frame.rotate(leg.end);
          strips.push({ left: a[0] - halfLength, right: b[0] + halfLength, low: y - halfWidth, high: y + halfWidth });
        }
        if (strips.length > MAX_LEGS || addedRows > MAX_VERTICES * 2) throw new Error('边缘补充航段过多，请简化边界或分区规划。');
      }
    }
    if (!changed) return { legs: orderScanRows(rowValues.sort((a, b) => a - b).flatMap(y => frame.rowAt(y, pass))), addedRows };
  }
  throw new Error('未能完成平面足迹覆盖检查，请拆分作业区域。');
}

function approximateCost(legs, settings) {
  let length = 0;
  for (let i = 0; i < legs.length; i++) {
    length += dist(legs[i].start, legs[i].end);
    if (i) length += dist(legs[i - 1].end, legs[i].start);
  }
  return length / settings.speed + Math.max(0, legs.length - 1) * settings.turnSeconds;
}

function createNavigator(polygon) {
  const allEdges = polygon.rings.flatMap(edgesOf);
  const permitted = p => classifyPoint(p, polygon.outer) >= 0 && polygon.holes.every(hole => classifyPoint(p, hole) <= 0);
  function visible(a, b) {
    if (!permitted(a) || !permitted(b)) return false;
    if (dist(a, b) < EPS) return true;
    const cuts = [0, 1];
    for (const [c, d] of allEdges) cuts.push(...intersectionParameters(a, b, c, d));
    cuts.sort((x, y) => x - y);
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i] - cuts[i - 1] > 1e-10 && !permitted(lerp(a, b, (cuts[i] + cuts[i - 1]) / 2))) return false;
    }
    return true;
  }
  const vertices = polygon.rings.flat();
  let baseGraph;
  function ensureGraph() {
    if (baseGraph) return;
    baseGraph = vertices.map(() => []);
    for (let i = 0; i < vertices.length; i++) {
      for (let j = i + 1; j < vertices.length; j++) {
        if (visible(vertices[i], vertices[j])) {
          const length = dist(vertices[i], vertices[j]);
          baseGraph[i].push([j, length]); baseGraph[j].push([i, length]);
        }
      }
    }
  }
  return (start, end) => {
    if (visible(start, end)) return [start, end];
    ensureGraph();
    const nodes = [...vertices, start, end], startId = vertices.length, endId = startId + 1;
    const graph = baseGraph.map(edges => [...edges]);
    graph.push([], []);
    for (const id of [startId, endId]) {
      for (let i = 0; i < vertices.length; i++) {
        if (visible(nodes[id], nodes[i])) {
          const length = dist(nodes[id], nodes[i]);
          graph[id].push([i, length]); graph[i].push([id, length]);
        }
      }
    }
    const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set();
    costs[startId] = 0;
    while (visited.size < nodes.length) {
      let best = -1;
      for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && Number.isFinite(costs[i]) && (best < 0 || costs[i] < costs[best])) best = i;
      if (best < 0) break;
      if (best === endId) {
        const path = [];
        for (let i = endId; i !== -1; i = previous[i]) path.push(nodes[i]);
        return path.reverse();
      }
      visited.add(best);
      for (const [neighbor, length] of graph[best]) {
        if (costs[best] + length < costs[neighbor]) { costs[neighbor] = costs[best] + length; previous[neighbor] = best; }
      }
    }
    throw new Error('无法在作业边界内找到连接航段的路径，请拆分作业区或调整排除区域。');
  };
}

/** Plan the horizontal capture geometry; terrain-route completes its elevations. */
export function planMission(ringLL, options = {}, holesLL = []) {
  const settings = validateOptions(options), polygon = preparePolygon(ringLL, holesLL);
  const geometry = cameraGeometry(settings);
  let heading = normalizeHeading(settings.heading), scans;
  const build = angle => {
    const first = makeScan(polygon, angle, geometry.lineSpacingM, 1);
    if (!settings.crossGrid) return first;
    return [...first, ...makeScan(polygon, normalizeHeading(angle + 90), geometry.lineSpacingM, 2)];
  };
  if (settings.autoHeading) {
    let bestCost = Infinity;
    for (let angle = 0; angle < 180; angle += 15) {
      const candidate = build(angle), cost = approximateCost(candidate, settings);
      if (cost < bestCost) { bestCost = cost; heading = angle; scans = candidate; }
    }
  } else scans = build(heading);
  if (!scans?.length) throw new Error('区域过窄，未能生成有效航段，请调整边界或航线方向。');
  const firstCoverage = completeFlatCoverage(polygon, heading, scans.filter(leg => leg.pass === 1), geometry, settings, 1);
  const secondCoverage = settings.crossGrid ? completeFlatCoverage(polygon, normalizeHeading(heading + 90), scans.filter(leg => leg.pass === 2), geometry, settings, 2) : { legs: [], addedRows: 0 };
  scans = [...firstCoverage.legs, ...secondCoverage.legs];
  const coverageAddedRows = firstCoverage.addedRows + secondCoverage.addedRows;
  if (scans.length > MAX_LEGS) throw new Error('航段数量超过 4000，请拆分作业区域。');
  const directionsPerStation = settings.captureMode === 'smartOrtho' ? 3 : 1;
  const expectedPhotos = directionsPerStation * scans.reduce((sum, leg) => sum + Math.max(1, Math.ceil(dist(leg.start, leg.end) / geometry.shotSpacingM)) + 1, 0);
  if (expectedPhotos > MAX_PHOTOS) throw new Error(`预计照片超过 ${MAX_PHOTOS} 张，请拆分作业区域。`);

  const navigate = createNavigator(polygon), inverse = polygon.projection.inverse;
  const legs = [], connections = [], photos = [], path = [];
  let captureDistanceM = 0, transitDistanceM = 0;
  for (let i = 0; i < scans.length; i++) {
    const scan = scans[i];
    if (i) {
      const positionsM = navigate(scans[i - 1].end, scan.start);
      for (let j = 1; j < positionsM.length; j++) transitDistanceM += dist(positionsM[j - 1], positionsM[j]);
      const positions = positionsM.map(inverse);
      connections.push({ positions }); path.push(...positions.slice(1));
    }
    const length = dist(scan.start, scan.end), intervals = Math.max(1, Math.ceil(length / geometry.shotSpacingM));
    const legPhotos = Array.from({ length: intervals + 1 }, (_, n) => inverse(lerp(scan.start, scan.end, n / intervals)));
    const start = legPhotos[0], end = legPhotos.at(-1);
    const flightHeadingDeg = ((Math.atan2(scan.end[0]-scan.start[0],scan.end[1]-scan.start[1])*180/Math.PI)%360+360)%360;
    legs.push({ id: i + 1, pass: scan.pass, start, end, photos: legPhotos, flightHeadingDeg });
    if (!i) path.push(start);
    path.push(end); photos.push(...legPhotos); captureDistanceM += length;
  }
  const distanceM = captureDistanceM + transitDistanceM;
  const warnings = [
    '高度仅以在线地形为依据，不考虑建筑、树木或其他障碍物；DEM 不是建筑 DSM，不能据此保证城市真正射成果或飞行净空。',
    '航段与转场均限制在所绘边界内；连接可贴边绕行，尚未预留水平安全距离，也未外扩补拍。边缘影像多视角覆盖需另行检查。',
    '影像足迹与 GSD 由标称对角视场角近似计算，未使用相机标定参数；实际照片模式、畸变校正和拍摄间隔需现场确认。',
    '预计时间只包含区内拍摄、连接和转弯；未计入机场往返、起降爬升、风、电量储备与分架次。该结果不等于可直接执行的飞行任务。',
  ];
  const camera = CAMERA_PROFILES[settings.camera];
  const minimumActualSpacing = Math.min(...scans.map(leg => {
    const length = dist(leg.start, leg.end);
    return length / Math.max(1, Math.ceil(length / geometry.shotSpacingM));
  }));
  if (minimumActualSpacing / settings.speed < camera.minInterval) warnings.push(`部分航段的照片间隔低于该机型 JPEG 参考最短间隔 ${camera.minInterval} 秒，执行前需降低速度或采用停悬拍照，并确认照片模式与固件能力。`);
  if (settings.captureMode === 'smartOrtho') {
    warnings.push(`三向近似姿态采用用户参数：侧向俯仰 ${settings.smartPitch}°，左右偏航 ±${settings.smartYaw}°，横滚 0°。足迹在采集站地形高度的水平面上估算，不是逐像素与真实地形求交。`);
    warnings.push('三向模式保留下视间距，照片按每站三张作预算；用户近似姿态不代表 DJI 原生任务的实际曝光位置、顺序或时序。');
    warnings.push('区内用时未包含三向摆动、稳定与曝光周期。大疆作业指南提示正射摆拍可能降低最终正射质量，需按成果要求确认是否使用。');
    if (minimumActualSpacing / settings.speed < 3 * camera.minInterval) warnings.push('部分站间飞行时间小于三张 JPEG 的参考拍照周期预算，且尚未计云台摆动时间；需在原生任务中验证航速。');
  }
  if (settings.autoHeading) warnings.push('自动航向以每 15° 采样的区内距离和转弯估算选择，尚未计入风向与机场进出方向，不代表全局最优。');
  if (coverageAddedRows) warnings.push(`已为细长突出部或尖角补充 ${coverageAddedRows} 条扫描行，满足近似平面足迹的至少一次覆盖；边缘多视角重叠仍需进一步校核。`);
  return {
    legs, connections, photos, path, heading,
    captureModel: createCaptureModel(camera, settings),
    captureRequests: legs.flatMap(leg=>leg.photos.map(position=>({position,legId:leg.id,flightHeadingDeg:leg.flightHeadingDeg}))).map((request,stationIndex)=>({
      ...request,stationIndex,mode:settings.captureMode,directionCount:directionsPerStation,nativeAngles:null,nativeTiming:null,
    })),
    projectionOrigin: polygon.projection.origin,
    heightMode: 'terrainAGL', captureMode: settings.captureMode,
    terrain: { status: 'pending' },
    stats: {
      areaM2: polygon.areaM2, distanceM, captureDistanceM, transitDistanceM,
      photoCount: photos.length * directionsPerStation, stationCount: photos.length, legCount: legs.length,
      photoCountIsEstimate: settings.captureMode === 'smartOrtho',
      captureTimingIncluded: false,
      coverageAddedRows,
      durationSeconds: distanceM / settings.speed + Math.max(0, legs.length - 1) * settings.turnSeconds,
      ...geometry,
      aglM: settings.altitude,
    },
    warnings,
  };
}
