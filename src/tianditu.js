import {
  Credit,
  Ellipsoid,
  GeographicTilingScheme,
  ImageryLayer,
  Resource,
  WebMapTileServiceImageryProvider,
} from 'cesium';

// CGCS2000 / EPSG:4490 uses the GRS80 ellipsoid. Keep the viewer, terrain,
// cartographic conversions, and this geographic WMTS tiling scheme consistent.
export const CGCS2000_SEMI_MAJOR_AXIS = 6378137;
export const CGCS2000_INVERSE_FLATTENING = 298.257222101;
export const CGCS2000_ELLIPSOID = new Ellipsoid(
  CGCS2000_SEMI_MAJOR_AXIS,
  CGCS2000_SEMI_MAJOR_AXIS,
  CGCS2000_SEMI_MAJOR_AXIS * (1 - 1 / CGCS2000_INVERSE_FLATTENING),
);

export const TIANDITU_CRS = 'EPSG:4490';
export const TIANDITU_MATRIX_SET = 'c';
export const TIANDITU_SUBDOMAINS = Object.freeze(['0', '1', '2', '3', '4', '5', '6', '7']);
export const TIANDITU_MATRIX_LABELS = Object.freeze(
  Array.from({ length: 19 }, (_, level) => String(level + 1)),
);

// Verified against each service's GetCapabilities: 2026-09-19.
// TianDiTu matrix 1 is 2 x 1 tiles, matching Cesium geographic level 0.
// img/cia/vec end at matrix 18; cva additionally provides matrix 19.
export const TIANDITU_LAYER_DEFINITIONS = Object.freeze({
  imagery: Object.freeze([
    Object.freeze({ layer: 'img', name: '影像底图', maximumMatrix: 18 }),
    Object.freeze({ layer: 'cia', name: '影像注记', maximumMatrix: 18 }),
  ]),
  vector: Object.freeze([
    Object.freeze({ layer: 'vec', name: '矢量底图', maximumMatrix: 18 }),
    Object.freeze({ layer: 'cva', name: '矢量注记', maximumMatrix: 19 }),
  ]),
});

/**
 * Returns [base, labels] in rendering order. Raster imagery does not supply
 * terrain/building elevations and must not be used as a DSM for flight safety.
 * The browser key is sent only to TianDiTu; never include it in error messages.
 */
export function createTiandituLayers(token, mode = 'imagery', onError = () => {}) {
  const key = typeof token === 'string' ? token.trim() : '';
  if (!key) throw new Error('请配置天地图服务密钥后加载底图。');
  const definitions = TIANDITU_LAYER_DEFINITIONS[mode];
  if (!definitions) throw new Error('不支持的天地图底图类型。');

  const tilingScheme = new GeographicTilingScheme({
    ellipsoid: CGCS2000_ELLIPSOID,
    numberOfLevelZeroTilesX: 2,
    numberOfLevelZeroTilesY: 1,
  });
  const credit = new Credit(
    '<a href="https://www.tianditu.gov.cn/" target="_blank" rel="noopener noreferrer">天地图 © 自然资源部</a>',
    true,
  );

  return definitions.map(({ layer, name, maximumMatrix }) => {
    const provider = new WebMapTileServiceImageryProvider({
      url: new Resource({
        url: `https://t{s}.tianditu.gov.cn/${layer}_c/wmts`,
        queryParameters: { tk: key },
      }),
      layer,
      style: 'default',
      format: 'tiles',
      tileMatrixSetID: TIANDITU_MATRIX_SET,
      tileMatrixLabels: TIANDITU_MATRIX_LABELS.slice(0, maximumMatrix),
      subdomains: [...TIANDITU_SUBDOMAINS],
      tilingScheme,
      tileWidth: 256,
      tileHeight: 256,
      minimumLevel: 0,
      maximumLevel: maximumMatrix - 1,
      credit,
    });

    let reported = false;
    provider.errorEvent.addEventListener((error) => {
      error.retry = false;
      if (reported) return;
      reported = true;
      // Do not forward Cesium's raw error: it may include the keyed tile URL.
      onError(`天地图${name}暂时无法加载，请检查网络、密钥配额或域名授权。`);
    });
    return new ImageryLayer(provider);
  });
}
