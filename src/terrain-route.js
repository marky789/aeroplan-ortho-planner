import { createLocalProjection, DEFAULT_OPTIONS } from './planner.js';

export const MAX_TERRAIN_SAMPLES = 50000;
const BATCH_SIZE = 256;
const coordinateKey = point => `${point[0].toFixed(12)},${point[1].toFixed(12)}`;

/**
 * Lift a horizontal mission onto a sampled terrain surface without changing its
 * permitted metric route. Heights retain the terrain provider's native datum.
 * sampleHeights receives unique [longitude, latitude] points and must return a
 * finite height for every point, in the same order. No missing-height fallback.
 */
export async function attachTerrainToPlan(plan, options, sampleHeights, metadata = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const spacing = settings.terrainSampleSpacing;
  if (!Number.isFinite(spacing) || spacing < 5 || spacing > 100) throw new Error('地形采样间距必须为 5–100 米。');
  if (!Number.isFinite(settings.altitude) || settings.altitude <= 0) throw new Error('离地高度必须为正数。');
  if (!Number.isFinite(settings.speed) || settings.speed <= 0 || !Number.isFinite(settings.turnSeconds) || settings.turnSeconds < 0) throw new Error('地形航线的速度和转弯时间无效。');
  if (typeof sampleHeights !== 'function') throw new Error('缺少在线地形采样服务。');
  if (!Array.isArray(plan?.legs) || !plan.legs.length || !Array.isArray(plan.connections) || plan.connections.length !== plan.legs.length - 1) throw new Error('地形航线需要有效且连续的水平规划结果。');
  const projection = createLocalProjection([plan.projectionOrigin]);
  const nodes = [], cache = new Map();

  function register(point) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) >= 85) throw new Error('地形航线包含无效经纬度坐标。');
    const key = coordinateKey(point);
    if (cache.has(key)) return cache.get(key);
    if (nodes.length >= MAX_TERRAIN_SAMPLES) throw new Error(`地形采样点超过 ${MAX_TERRAIN_SAMPLES} 个，请拆分作业区域或增大采样间距。`);
    const node = { ll: point.slice(0, 2), xy: projection.forward(point.slice(0, 2)) };
    if (!node.xy.every(Number.isFinite)) throw new Error('地形航线坐标无法转换到局部米制平面。');
    cache.set(key, node); nodes.push(node);
    return node;
  }

  function densify(points) {
    if (!Array.isArray(points) || points.length < 2) throw new Error('地形航段至少需要两个点。');
    const result = [register(points[0])];
    for (let i = 1; i < points.length; i++) {
      const a = result.at(-1), b = register(points[i]);
      if (a === b) continue;
      const distance = Math.hypot(b.xy[0] - a.xy[0], b.xy[1] - a.xy[1]);
      const count = Math.max(1, Math.ceil(distance / spacing));
      // Bound the loop even when a malformed input creates a huge segment.
      if (count > MAX_TERRAIN_SAMPLES) throw new Error(`地形采样点超过 ${MAX_TERRAIN_SAMPLES} 个，请拆分作业区域或增大采样间距。`);
      for (let j = 1; j < count; j++) {
        const t = j / count;
        const xy = [a.xy[0] + (b.xy[0] - a.xy[0]) * t, a.xy[1] + (b.xy[1] - a.xy[1]) * t];
        result.push(register(projection.inverse(xy)));
      }
      result.push(b);
    }
    return result;
  }

  // Photos are explicit break points, so their exact positions are sampled too.
  const captureNodes = plan.legs.map(leg => {
    if (!Array.isArray(leg.photos) || !leg.photos.length) throw new Error('拍摄航段缺少照片位置。');
    return densify([leg.start, ...leg.photos, leg.end]);
  });
  const connectionNodes = plan.connections.map(connection => densify(connection.positions));
  const requestNodes = plan.captureRequests?.map(request => register(request.position));

  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);
    let heights;
    try { heights = await sampleHeights(batch.map(node => [...node.ll])); }
    catch (error) { throw new Error(`在线地形采样失败：${error?.message || String(error)}`); }
    if (!Array.isArray(heights) || heights.length !== batch.length || !Array.from(heights).every(Number.isFinite)) {
      throw new Error('在线地形高程缺失或无效，已停止生成航线；请恢复地形服务后重试。');
    }
    batch.forEach((node, index) => {
      node.terrain = heights[index];
      node.position = [...node.ll, heights[index] + settings.altitude];
    });
  }

  const positionOf = point => cache.get(coordinateKey(point)).position;
  const legs = plan.legs.map((leg, index) => ({
    ...leg, positions: captureNodes[index].map(node => node.position),
    start: positionOf(leg.start), end: positionOf(leg.end), photos: leg.photos.map(positionOf),
  }));
  const connections = plan.connections.map((connection, index) => ({ ...connection, positions: connectionNodes[index].map(node => node.position) }));
  const path = [...legs[0].positions];
  for (let i = 1; i < legs.length; i++) path.push(...connections[i - 1].positions.slice(1), ...legs[i].positions.slice(1));

  let horizontalDistanceM = 0, maxClimbGradient = 0, maxDescentGradient = 0;
  let maxRequiredClimbRateMps = 0, maxRequiredDescentRateMps = 0;
  let elevationGainM = 0, elevationLossM = 0;
  const routeLength = line => line.slice(1).reduce((sum, b, i) => {
    const a = line[i], horizontal = Math.hypot(b.xy[0] - a.xy[0], b.xy[1] - a.xy[1]);
    const dz = b.terrain - a.terrain, distance = Math.hypot(horizontal, dz);
    horizontalDistanceM += horizontal;
    if (horizontal > 0) {
      maxClimbGradient = Math.max(maxClimbGradient, dz / horizontal);
      maxDescentGradient = Math.max(maxDescentGradient, -dz / horizontal);
    }
    if (distance > 0) {
      // speed denotes speed along the final three-dimensional route.
      maxRequiredClimbRateMps = Math.max(maxRequiredClimbRateMps, settings.speed * dz / distance);
      maxRequiredDescentRateMps = Math.max(maxRequiredDescentRateMps, -settings.speed * dz / distance);
    }
    elevationGainM += Math.max(0, dz); elevationLossM += Math.max(0, -dz);
    return sum + distance;
  }, 0);
  const captureDistanceM = captureNodes.reduce((sum, line) => sum + routeLength(line), 0);
  const transitDistanceM = connectionNodes.reduce((sum, line) => sum + routeLength(line), 0);
  const distanceM = captureDistanceM + transitDistanceM;
  const terrainMinM = Math.min(...nodes.map(node => node.terrain));
  const terrainMaxM = Math.max(...nodes.map(node => node.terrain));
  const warnings = [...(plan.warnings || []),
    `已按不超过 ${spacing} 米的水平间距及全部照片位置采样地形；固定离地高度仅在采样点成立，点间采用线性连接，未证明连续净空或影像重叠率。`,
    '航线绝对高程沿用地形源的垂直基准；导入飞行系统前必须完成高程基准、上升下降能力及实际地形精度校核。',
  ];
  if (maxClimbGradient > 0.2 || maxDescentGradient > 0.2) warnings.push(`相邻采样点的最大上升坡度 ${(maxClimbGradient * 100).toFixed(1)}%、下降坡度 ${(maxDescentGradient * 100).toFixed(1)}%；按当前三维航速估算最大爬升 ${maxRequiredClimbRateMps.toFixed(2)} m/s、下降 ${maxRequiredDescentRateMps.toFixed(2)} m/s，尚未按飞行器性能自动减速。`);
  return {
    ...plan, legs, connections, path, photos: legs.flatMap(leg => leg.photos), heightMode: 'terrainAGL',
    ...(requestNodes ? { captureRequests: plan.captureRequests.map((request, index) => ({ ...request, position: requestNodes[index].position })) } : {}),
    terrain: {
      ...metadata, status: 'ready', source: metadata.source || 'online-terrain',
      verticalDatum: metadata.verticalDatum || 'source-native-unspecified',
      sampleSpacingM: spacing, sampleCount: nodes.length,
    },
    stats: {
      ...plan.stats, horizontalDistanceM, distanceM, captureDistanceM, transitDistanceM,
      terrainMinM, terrainMaxM, absoluteHeightMinM: terrainMinM + settings.altitude,
      absoluteHeightMaxM: terrainMaxM + settings.altitude, aglM: settings.altitude,
      maxClimbGradient, maxDescentGradient, maxRequiredClimbRateMps, maxRequiredDescentRateMps, elevationGainM, elevationLossM,
      durationSeconds: distanceM / settings.speed + Math.max(0, legs.length - 1) * settings.turnSeconds + (plan.stats?.capturePauseSeconds || 0),
    },
    warnings,
  };
}
