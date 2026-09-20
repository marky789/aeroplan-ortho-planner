/** Portable planning data only: a terrain datum is mandatory for all heights. */
function assertReady(plan) {
  if (plan?.terrain?.status !== 'ready' || !plan.terrain.verticalDatum || !plan.photos.every(p => Number.isFinite(p[2]))) {
    throw new Error('地形高度尚未完成采样，不能导出。');
  }
}
export function exportMission(state, plan) {
  assertReady(plan);
  return {
    format: 'aeroplan', version: 2, crs: 'EPSG:4490',
    planningStatus: 'terrain-sampled-unverified',
    ...state, plan,
    heightReference: { mode: 'terrainAGL', verticalDatum: plan.terrain.verticalDatum,
      formula: 'flightHeight = sourceTerrainHeight + altitudeAGL', ellipsoidConversionApplied: false },
    notes: ['绝对高程沿用在线地形源的正高基准，未转椭球高或国家高程基准。',
      '高度只考虑地形，不计建筑和机场高度；未校核障碍物或机场进出路径。',
      '三向采集请求不是实际曝光指令；JSON / CSV 不是可执行 DJI 飞行文件。'],
  };
}
const cell = value => `"${String(value).replaceAll('"', '""')}"`;
export function exportStationsCsv(state, plan) {
  assertReady(plan);
  const rows = [['采集站序号','经度_CGCS2000','纬度_CGCS2000','地形源高程_m','飞行绝对高程_m','离地高度_m','采集方式','每站预算照片数','高程基准']];
  plan.photos.forEach((p, i) => rows.push([i + 1, p[0].toFixed(9), p[1].toFixed(9),
    (p[2] - state.options.altitude).toFixed(3), p[2].toFixed(3), state.options.altitude,
    plan.captureMode, plan.captureMode === 'smartOrtho' ? 3 : 1, plan.terrain.verticalDatum]));
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
