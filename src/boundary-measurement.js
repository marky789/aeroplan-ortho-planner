import { Cartesian3, Cartographic, EllipsoidGeodesic, Math as CesiumMath } from 'cesium';
import { CGCS2000_ELLIPSOID } from './tianditu.js';

const MIN_EDGE_M = 0.01;

function normalizePoint(value) {
  if (!Array.isArray(value) || value.length < 2
      || !Number.isFinite(value[0]) || !Number.isFinite(value[1])
      || value[0] < -180 || value[0] > 180 || value[1] < -90 || value[1] > 90) {
    throw new Error('边界测距需要有效的经纬度坐标。');
  }
  const point = [value[0], value[1]];
  return {
    point,
    surface: Cartesian3.fromDegrees(point[0], point[1], 0, CGCS2000_ELLIPSOID),
  };
}

// A chord is indistinguishable from its surface arc at the 1 cm duplicate
// threshold, and remains well-defined even when two points are antipodal.
function isDuplicate(a, b) {
  return Cartesian3.distance(a.surface, b.surface) < MIN_EDGE_M;
}

function measureSegment(start, end, kind) {
  if (isDuplicate(start, end)) return null;
  try {
    const geodesic = new EllipsoidGeodesic(
      Cartographic.fromDegrees(...start.point),
      Cartographic.fromDegrees(...end.point),
      CGCS2000_ELLIPSOID,
    );
    const distanceM = geodesic.surfaceDistance;
    const center = geodesic.interpolateUsingFraction(0.5);
    const midpoint = [CesiumMath.toDegrees(center.longitude), CesiumMath.toDegrees(center.latitude)];
    if (!Number.isFinite(distanceM) || !midpoint.every(Number.isFinite)) throw new Error('nonfinite');
    return { start: start.point, end: end.point, midpoint, distanceM, kind };
  } catch {
    throw new Error('边界点之间距离过远，暂时无法计算可靠的椭球测地线距离。');
  }
}

/**
 * Measure map boundary edges on the EPSG:4490 ellipsoid, without elevation.
 * Confirmed input points are de-duplicated within 1 cm. An open ring includes
 * a mouse-preview edge and, once it has 3 unique points, a closing preview.
 * Closing previews do not count toward confirmedLengthM.
 */
export function measureBoundary(points, { closed = false, hover = null } = {}) {
  if (!Array.isArray(points)) throw new Error('边界点必须为经纬度数组。');
  const unique = [];
  for (const value of points) {
    const normalized = normalizePoint(value);
    if (!unique.some(point => isDuplicate(point, normalized))) unique.push(normalized);
  }
  const mouse = hover === null ? null : normalizePoint(hover);
  const segments = [];
  const append = (start, end, kind) => {
    const segment = measureSegment(start, end, kind);
    if (segment) segments.push(segment);
  };
  for (let index = 1; index < unique.length; index += 1) {
    append(unique[index - 1], unique[index], 'confirmed');
  }

  if (closed) {
    if (unique.length >= 3) append(unique.at(-1), unique[0], 'confirmed');
  } else if (unique.length) {
    let visibleEnd = unique.at(-1);
    const mouseIsNew = mouse && !unique.some(point => isDuplicate(point, mouse));
    const visibleUniqueCount = unique.length + (mouseIsNew ? 1 : 0);
    // A hover over an earlier vertex still changes the drawn preview path.
    // Only the last vertex is a zero-length preview. For two confirmed points,
    // hovering over the first would merely double the same edge, so omit it.
    if (mouse && !isDuplicate(unique.at(-1), mouse) && (mouseIsNew || visibleUniqueCount >= 3)) {
      append(unique.at(-1), mouse, 'preview');
      visibleEnd = mouse;
    }
    if (visibleUniqueCount >= 3 && !isDuplicate(visibleEnd, unique[0])) {
      append(visibleEnd, unique[0], 'closing');
    }
  }

  return {
    segments,
    confirmedLengthM: segments.reduce((sum, edge) => sum + (edge.kind === 'confirmed' ? edge.distanceM : 0), 0),
    perimeterM: segments.reduce((sum, edge) => sum + edge.distanceM, 0),
  };
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) throw new Error('距离必须为有效的非负数值。');
  return meters < 1000 ? `${meters.toFixed(1)} m` : `${(meters / 1000).toFixed(2)} km`;
}
