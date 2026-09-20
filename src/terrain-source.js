// Public terrain data: https://registry.opendata.aws/terrain-tiles/
// Encoding and attribution: https://github.com/tilezen/joerd/tree/master/docs
export const TERRAIN_LEVEL = 13;
export const TERRAIN_METADATA = Object.freeze({
  id: 'mapzen-terrarium',
  source: 'Mapzen Terrain Tiles / AWS Open Data',
  name: 'Mapzen Terrain Tiles / AWS Open Data',
  url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium',
  sampleLevel: TERRAIN_LEVEL,
  maximumLevel: TERRAIN_LEVEL,
  verticalDatum: 'source-orthometric',
  verticalDatumLabel: '地形源正高（多源基准，未转换为椭球高）',
  horizontalDatum: 'WGS84 / Web Mercator',
  description: '多源公开高程数据；中国地区主要为 SRTM，采样像素大小不代表原始数据精度。',
  attributionUrl: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
});

const SIZE = 256;
const MAX_LATITUDE = 85.0511287798066;
const SOURCE_ERROR = '在线地形数据获取失败，请检查网络后重试；本次未生成带高程航线。';

export function decodeTerrariumPixels(rgba, width = SIZE, height = SIZE) {
  if (width !== SIZE || height !== SIZE || rgba.length !== SIZE * SIZE * 4) throw new Error('在线地形瓦片尺寸异常。');
  const values = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < values.length; i++) {
    const offset = i * 4;
    const value = rgba[offset] * 256 + rgba[offset + 1] + rgba[offset + 2] / 256 - 32768;
    if (rgba[offset + 3] !== 255 || !Number.isFinite(value) || value < -12000 || value > 10000) throw new Error('在线地形瓦片含无效高程。');
    values[i] = value;
  }
  return values;
}

async function fetchTerrainTile(x, y, level) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let bitmap;
    try {
      const response = await fetch(`${TERRAIN_METADATA.url}/${level}/${x}/${y}.png`, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error(SOURCE_ERROR);
      bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(SIZE, SIZE) : document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error(SOURCE_ERROR);
      context.drawImage(bitmap, 0, 0);
      return decodeTerrariumPixels(context.getImageData(0, 0, SIZE, SIZE).data, bitmap.width, bitmap.height);
    } catch {
      if (attempt === 1) throw new Error(SOURCE_ERROR);
    } finally {
      clearTimeout(timeout);
      bitmap?.close();
    }
  }
}

// Pixel centres are at i + 0.5. Both rendering and numeric sampling use this
// same cross-tile interpolation, including shared boundary vertices.
function pixelStencil(worldX, worldY, level) {
  const count = 2 ** level, pixels = count * SIZE;
  const px = worldX * SIZE - 0.5;
  const py = Math.max(0, Math.min(pixels - 1, worldY * SIZE - 0.5));
  const x0 = Math.floor(px), y0 = Math.floor(py), dx = px - x0, dy = py - y0;
  const parts = [];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const weight = (col ? dx : 1 - dx) * (row ? dy : 1 - dy);
    if (!weight) continue;
    const gx = ((x0 + col) % pixels + pixels) % pixels;
    const gy = Math.min(pixels - 1, y0 + row);
    const x = Math.floor(gx / SIZE), y = Math.floor(gy / SIZE);
    parts.push({ key: `${level}/${x}/${y}`, x, y, level, index: (gy % SIZE) * SIZE + gx % SIZE, weight });
  }
  return parts;
}

function worldPosition(point, level) {
  if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > MAX_LATITUDE) throw new Error('地形采样坐标无效或超出覆盖范围。');
  const count = 2 ** level, latitude = point[1] * Math.PI / 180;
  return [(point[0] + 180) / 360 * count, (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * count];
}

export function createTerrariumSampler({ loadTile = fetchTerrainTile, maxCacheSize = 128, concurrency = 6 } = {}) {
  if (!Number.isInteger(maxCacheSize) || maxCacheSize < 1 || !Number.isInteger(concurrency) || concurrency < 1) throw new Error('地形缓存配置无效。');
  const cache = new Map(), pending = new Map(), queue = [];
  let active = 0;
  function drain() {
    while (active < concurrency && queue.length) {
      const job = queue.shift(); active++;
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { active--; drain(); });
    }
  }
  function tile(part) {
    if (cache.has(part.key)) {
      const value = cache.get(part.key); cache.delete(part.key); cache.set(part.key, value);
      return Promise.resolve(value);
    }
    if (pending.has(part.key)) return pending.get(part.key);
    const promise = new Promise((resolve, reject) => {
      queue.push({ run: () => loadTile(part.x, part.y, part.level), resolve, reject }); drain();
    }).then(values => {
      if (!values || values.length !== SIZE * SIZE) throw new Error('在线地形瓦片数据不完整。');
      cache.set(part.key, values);
      while (cache.size > maxCacheSize) cache.delete(cache.keys().next().value);
      return values;
    }).finally(() => pending.delete(part.key));
    pending.set(part.key, promise);
    return promise;
  }
  async function sampleStencils(stencils) {
    const requests = new Map();
    for (const stencil of stencils) for (const part of stencil) requests.set(part.key, part);
    const grids = new Map(await Promise.all([...requests].map(async ([key, part]) => [key, await tile(part)])));
    return stencils.map(stencil => {
      let value = 0;
      for (const part of stencil) {
        const height = grids.get(part.key)[part.index];
        if (!Number.isFinite(height) || height < -12000 || height > 10000) throw new Error('在线地形采样缺失，不能以零高程替代。');
        value += height * part.weight;
      }
      return value;
    });
  }
  return {
    async sampleHeights(points) {
      if (!Array.isArray(points) || points.length > 60000) throw new Error('地形采样点数量超出范围。');
      const positions = points.map(point => worldPosition(point, TERRAIN_LEVEL));
      const heights = [];
      for (let i = 0; i < positions.length; i += 500) {
        const stencils = positions.slice(i, i + 500).map(([x, y]) => pixelStencil(x, y, TERRAIN_LEVEL));
        heights.push(...await sampleStencils(stencils));
      }
      return heights;
    },
    async heightmap(x, y, level) {
      if (!Number.isInteger(level) || level < 0 || level > TERRAIN_LEVEL || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= 2 ** level || y >= 2 ** level) throw new Error('地形瓦片层级或索引无效。');
      const stencils = [];
      for (let row = 0; row <= SIZE; row++) for (let col = 0; col <= SIZE; col++) stencils.push(pixelStencil(x + col / SIZE, y + row / SIZE, level));
      return new Float32Array(await sampleStencils(stencils));
    },
  };
}

export async function createOnlineTerrain({ ellipsoid } = {}) {
  const { Credit, Event, HeightmapTerrainData, TerrainProvider, WebMercatorTilingScheme } = await import('cesium');
  const sampler = createTerrariumSampler();
  const tilingScheme = new WebMercatorTilingScheme({ ellipsoid });
  const levelZeroError = TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(tilingScheme.ellipsoid, SIZE + 1, 1);
  let renderingRequests = 0;
  const provider = {
    tilingScheme,
    errorEvent: new Event(),
    credit: new Credit('<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener noreferrer">Terrain Tiles by Mapzen / AWS Open Data</a> · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener noreferrer">USGS, NOAA and other providers</a>', true),
    hasWaterMask: false,
    hasVertexNormals: false,
    availability: undefined,
    getLevelMaximumGeometricError: level => levelZeroError / 2 ** level,
    getTileDataAvailable: (x, y, level) => level <= TERRAIN_LEVEL,
    loadTileDataAvailability: () => undefined,
    requestTileGeometry(x, y, level) {
      if (renderingRequests >= 6) return undefined;
      renderingRequests++;
      return sampler.heightmap(x, y, level).then(buffer => new HeightmapTerrainData({ buffer, width: SIZE + 1, height: SIZE + 1, childTileMask: level < TERRAIN_LEVEL ? 15 : 0 })).finally(() => renderingRequests--);
    },
  };
  return { provider, sampleHeights: sampler.sampleHeights, metadata: { ...TERRAIN_METADATA } };
}
