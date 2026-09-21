const RAD = Math.PI / 180;
const area = corners => Math.abs(corners.reduce((sum, p, i) => {
  const q = corners[(i + 1) % corners.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

export function cameraHalfAngles(camera) {
  const diagonal = Math.hypot(camera.width, camera.height);
  const tanDiagonal = Math.tan(camera.diagonalFov * RAD / 2);
  return {
    horizontalDeg: Math.atan(camera.width / diagonal * tanDiagonal) / RAD,
    verticalDeg: Math.atan(camera.height / diagonal * tanDiagonal) / RAD,
  };
}

/** Document cross-section model: x cross-track, y along-track, z up.
 * axisTiltDeg is an optical-axis deflection from nadir toward x, not yaw.
 * The surface is the horizontal plane at the capture station's terrain height.
 */
export function footprintOffsets(camera, altitude, axisTiltDeg = 0) {
  const angles = cameraHalfAngles(camera);
  const tx = Math.tan(angles.horizontalDeg * RAD), ty = Math.tan(angles.verticalDeg * RAD);
  const b = axisTiltDeg * RAD, c = Math.cos(b), s = Math.sin(b);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
    const denominator = c - x * tx * s;
    if (denominator <= 1e-8) throw new Error('相机足迹触及地平线，无法计算有限覆盖。');
    return [altitude * (s + x * tx * c) / denominator, altitude * y * ty / denominator];
  });
  return { corners, areaM2: area(corners) };
}

// Quality angle in this document is a cross-track angle, not a radial 3D angle.
function clipQuality(corners, halfWidth) {
  let result = corners;
  for (const sign of [-1, 1]) {
    const clipped = [];
    for (let i = 0; i < result.length; i++) {
      const a = result[i], b = result[(i + 1) % result.length];
      const aInside = sign * a[0] <= halfWidth, bInside = sign * b[0] <= halfWidth;
      if (aInside) clipped.push(a);
      if (aInside !== bInside) {
        const x = sign * halfWidth, t = (x - a[0]) / (b[0] - a[0]);
        clipped.push([x, a[1] + t * (b[1] - a[1])]);
      }
    }
    result = clipped;
  }
  return result;
}

/** Union of cross-track footprint projections; overlaps count once. */
export function combinedCrossTrackSwath(views) {
  if (!Array.isArray(views) || !views.length) throw new Error('综合扫宽需要有效的相机足迹。');
  const intervals = views.map(view => {
    if (!Array.isArray(view.corners) || view.corners.length < 3 || !view.corners.every(p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite))) throw new Error('相机足迹坐标无效。');
    const xs = view.corners.map(p => p[0]);
    return [Math.min(...xs), Math.max(...xs)];
  }).sort((a, b) => a[0] - b[0]);
  const intervalsM = [];
  for (const [left, right] of intervals) {
    const last = intervalsM.at(-1);
    if (last && left <= last[1] + 1e-8) last[1] = Math.max(last[1], right);
    else intervalsM.push([left, right]);
  }
  const widthM = intervalsM.reduce((sum, [left, right]) => sum + right - left, 0);
  if (!(widthM > 0)) throw new Error('综合扫宽必须大于零。');
  return { intervalsM, widthM, continuous: intervalsM.length === 1 };
}

export function createCaptureModel(camera, settings) {
  const smart = settings.captureMode === 'smartOrtho', angles = cameraHalfAngles(camera);
  const beta = smart ? settings.sideTiltDeg : 0;
  if (smart && beta > 2 * angles.horizontalDeg) throw new Error('侧摆角 β 超过两倍水平半视场角，三向横向投影不连续。');
  if (beta + angles.horizontalDeg >= 90) throw new Error('侧摆角与水平半视场角之和须小于 90°，否则足迹触及地平线。');
  const effectiveEdgeAngleDeg = smart ? Math.min(beta + angles.horizontalDeg, settings.qualityCutoffDeg) : angles.horizontalDeg;
  const halfWidth = settings.altitude * Math.tan(effectiveEdgeAngleDeg * RAD);
  const poses = smart ? [['left', -beta], ['nadir', 0], ['right', beta]] : [['nadir', 0]];
  const views = poses.map(([name, axisTiltDeg]) => {
    const footprint = footprintOffsets(camera, settings.altitude, axisTiltDeg);
    const usableCorners = smart ? clipQuality(footprint.corners, halfWidth) : footprint.corners;
    return { name, axisTiltDeg, ...footprint, usableCorners, usableAreaM2: area(usableCorners) };
  });
  const union = combinedCrossTrackSwath(views.filter(v => v.usableAreaM2 > 0).map(v => ({ corners: v.usableCorners })));
  if (!union.continuous) throw new Error('三向横向投影存在间隙，不能作为连续综合航带规划。');
  return {
    mode: settings.captureMode, poseSource: smart ? 'document-cross-track-model' : 'nadir',
    surfaceModel: 'horizontal-plane-at-sampled-terrain',
    spacingBasis: smart ? 'quality-clipped-cross-track' : 'nadir-footprint',
    hardwareSupport: 'unverified', nativeTiming: null, executionVerified: false,
    measuredCaptureCycleSeconds: smart ? settings.captureCycleSeconds : null,
    angles, views,
    swath: {
      ...union, model: smart ? 'quality-clipped-cross-track' : 'nadir-footprint',
      widthM: 2 * halfWidth,
      theoreticalWidthM: 2 * settings.altitude * Math.tan((beta + angles.horizontalDeg) * RAD),
      sideTiltDeg: beta, qualityCutoffDeg: smart ? settings.qualityCutoffDeg : null,
      effectiveEdgeAngleDeg, edgeGsdScale: 1 / Math.cos(effectiveEdgeAngleDeg * RAD) ** 2,
    },
  };
}
