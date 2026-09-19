import {
  Viewer, Ellipsoid, EllipsoidTerrainProvider, GeographicProjection, Globe,
  Cartesian3, Cartesian2, Math as CMath, Color, PolygonHierarchy,
  CustomDataSource, ScreenSpaceEventHandler, ScreenSpaceEventType, BoundingSphere,
  HeadingPitchRange, PolylineDashMaterialProperty, PointPrimitiveCollection,
  LabelStyle, VerticalOrigin,
  SceneTransforms,
} from 'cesium';
import { CGCS2000_ELLIPSOID, createTiandituLayers } from './tianditu.js';

const GREEN = Color.fromCssColorString('#35e5b0');
const WHITE = Color.fromCssColorString('#ffffff');
const AMBER = Color.fromCssColorString('#ffca75');
const LL = p => Cartesian3.fromDegrees(p[0], p[1], p[2] || 0, CGCS2000_ELLIPSOID);

export function createMap(container, callbacks) {
  Ellipsoid.default = CGCS2000_ELLIPSOID;
  const viewer = new Viewer(container, {
    baseLayer: false, baseLayerPicker: false, animation: false, timeline: false,
    geocoder: false, homeButton: false, sceneModePicker: false, selectionIndicator: false,
    infoBox: false, navigationHelpButton: false, fullscreenButton: false,
    globe: new Globe(CGCS2000_ELLIPSOID),
    terrainProvider: new EllipsoidTerrainProvider({ ellipsoid: CGCS2000_ELLIPSOID }),
    mapProjection: new GeographicProjection(CGCS2000_ELLIPSOID),
    requestRenderMode: true, maximumRenderTimeChange: Infinity,
    skyBox: false, skyAtmosphere: false, msaaSamples: 2,
  });
  viewer.scene.backgroundColor = Color.fromCssColorString('#172c31');
  viewer.scene.globe.baseColor = Color.fromCssColorString('#233b40');
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 100;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 18000000;
  viewer.scene.screenSpaceCameraController.enableTilt = false;
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  const areas = new CustomDataSource('area');
  const routes = new CustomDataSource('route');
  const sketches = new CustomDataSource('sketch');
  viewer.dataSources.add(areas); viewer.dataSources.add(routes); viewer.dataSources.add(sketches);
  const photoPoints = viewer.scene.primitives.add(new PointPrimitiveCollection());
  let mode = null, draft = [], hover = null, model = null, is3D = false;
  let showPhotos = false, drag = null, frame = null, moving = null;
  const handler = new ScreenSpaceEventHandler(viewer.canvas);
  viewer.canvas.addEventListener('contextmenu', event => event.preventDefault());
  function request() { viewer.scene.requestRender(); }
  function pick(position) {
    const cart = viewer.camera.pickEllipsoid(position, CGCS2000_ELLIPSOID);
    if (!cart) return null;
    const c = CGCS2000_ELLIPSOID.cartesianToCartographic(cart);
    return [CMath.toDegrees(c.longitude), CMath.toDegrees(c.latitude)];
  }
  function polyline(target, points, color, width = 2, dashed = false) {
    if (points.length < 2) return;
    target.entities.add({ polyline: { positions: points.map(LL), width,
      material: dashed ? new PolylineDashMaterialProperty({ color, dashLength: 12 }) : color,
      clampToGround: false,
    } });
  }
  function point(target, p, label, color = GREEN, id) {
    return target.entities.add({ id, position: LL(p), point: {
      pixelSize: label ? 11 : 8, color, outlineColor: WHITE, outlineWidth: 2,
      disableDepthTestDistance: Infinity,
    }, ...(label ? { label: { text: label, font: '500 12px sans-serif',
      fillColor: WHITE, outlineColor: Color.fromCssColorString('#172c31'), outlineWidth: 4,
      style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -20),
      verticalOrigin: VerticalOrigin.BOTTOM, disableDepthTestDistance: Infinity,
    } } : {}) });
  }
  function sketch() {
    sketches.entities.removeAll();
    const positions = [...draft, ...(hover && draft.length ? [hover] : [])];
    if (positions.length > 2) sketches.entities.add({ polygon: {
      hierarchy: new PolygonHierarchy(positions.map(LL)),
      material: (mode === 'hole' ? AMBER : GREEN).withAlpha(.13), height: 0,
    } });
    polyline(sketches, positions, mode === 'hole' ? AMBER : GREEN, 2);
    draft.forEach((p, i) => point(sketches, p, String(i + 1), mode === 'hole' ? AMBER : GREEN));
    callbacks.onDraft?.(draft.length); request();
  }
  function setMode(next) {
    stopPreview(); mode = next; draft = []; hover = null;
    viewer.canvas.classList.toggle('drawing', !!next);
    viewer.scene.screenSpaceCameraController.enableRotate = !next;
    sketch(); callbacks.onMode?.(mode);
  }
  function finish() {
    if (!mode || mode === 'dock' || draft.length < 3) return false;
    const type = mode, points = draft.map(p => [...p]);
    if (callbacks.onComplete?.(type, points) === false) return false;
    setMode(null); return true;
  }
  handler.setInputAction(event => {
    if (drag !== null) return;
    const p = pick(event.position);
    if (!p) return;
    if (mode === 'dock') { callbacks.onDock?.(p); setMode(null); return; }
    if (!mode) return;
    if (draft.length && Math.hypot(p[0]-draft.at(-1)[0],p[1]-draft.at(-1)[1]) < 1e-7) return;
    draft.push(p); hover = null; sketch();
  }, ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction(() => finish(), ScreenSpaceEventType.RIGHT_CLICK);
  handler.setInputAction(event => {
    if (mode) return;
    const picked = viewer.scene.pick(event.position);
    const id = picked?.id?.id;
    if (typeof id === 'string' && id.startsWith('vertex-')) {
      drag = Number(id.slice(7));
      viewer.scene.screenSpaceCameraController.enableRotate = false;
      viewer.scene.screenSpaceCameraController.enableTranslate = false;
    }
  }, ScreenSpaceEventType.LEFT_DOWN);
  handler.setInputAction(event => {
    const p = pick(event.endPosition);
    if (!p) return;
    callbacks.onCoordinate?.(p);
    if (drag !== null && model) {
      areas.entities.getById(`vertex-${drag}`).position = LL(p);
      request();
      return;
    }
    if (mode && mode !== 'dock') { hover = p; sketch(); }
  }, ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(event => {
    if (drag === null) return;
    const index = drag; drag = null;
    viewer.scene.screenSpaceCameraController.enableRotate = true;
    viewer.scene.screenSpaceCameraController.enableTranslate = true;
    const p = pick(event.position);
    if (p) callbacks.onVertexMove?.(index, p);
  }, ScreenSpaceEventType.LEFT_UP);
  function draw(nextModel) {
    stopPreview(); model = nextModel;
    areas.entities.removeAll(); routes.entities.removeAll(); photoPoints.removeAll();
    const { ring = [], holes = [], plan, dock, altitude = 100, dockHeight = 0 } = model;
    if (ring.length >= 3) {
      areas.entities.add({ polygon: {
        hierarchy: new PolygonHierarchy(ring.map(LL), holes.map(h => new PolygonHierarchy(h.map(LL)))),
        height: 0, material: GREEN.withAlpha(.12),
      } });
      polyline(areas, [...ring, ring[0]], GREEN, 3);
      ring.forEach((p, i) => point(areas, p, null, GREEN, `vertex-${i}`));
      holes.forEach(h => polyline(areas, [...h, h[0]], AMBER, 2));
    }
    const z = is3D ? altitude : 2;
    if (plan) {
      plan.legs.forEach(leg => polyline(routes, [[...leg.start,z], [...leg.end,z]],
        leg.pass === 2 ? GREEN.withAlpha(.65) : GREEN, 2));
      plan.connections.forEach(c => polyline(routes, c.positions.map(p => [...p,z]), WHITE.withAlpha(.7), 1.6, true));
      for (const p of plan.photos) photoPoints.add({ position: LL([...p,z+1]), pixelSize: 3.8,
        color: WHITE.withAlpha(.9), disableDepthTestDistance: Infinity });
      photoPoints.show = showPhotos;
      if (plan.path.length) {
        point(routes, [...plan.path[0],z], '起点', GREEN);
        point(routes, [...plan.path.at(-1),z], '终点', AMBER);
      }
    }
    if (dock) point(areas, [...dock, is3D ? dockHeight : 2], '机场', Color.fromCssColorString('#5ab9ff'));
    request();
  }
  function fit(ring = model?.ring, duration = .8) {
    if (!ring?.length) return;
    const positions = ring.map(LL);
    if (is3D) positions.push(...ring.map(p=>LL([...p,model?.altitude||100])));
    const sphere = BoundingSphere.fromPoints(positions);
    const range = Math.max(550, sphere.radius * 3.6);
    viewer.camera.flyToBoundingSphere(sphere, { duration,
      offset: new HeadingPitchRange(0, is3D ? -Math.PI/4 : -(Math.PI/2-.0001), range),
      complete: () => {
        // Frame the actual usable map space above the mission review panel.
        const box=viewer.canvas.getBoundingClientRect(), root=viewer.container.closest('.map-workspace');
        const top=(root.querySelector('.map-tools').getBoundingClientRect().bottom-box.top)+24;
        const bottom=(root.querySelector('.mission-review').getBoundingClientRect().top-box.top)-28;
        const height=Math.max(100,bottom-top);
        function bounds(){
          const points=positions.map(p=>SceneTransforms.worldToWindowCoordinates(viewer.scene,p)).filter(Boolean);
          return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))};
        }
        let b=bounds();
        const scale=Math.max(1,(b.maxX-b.minX+70)/box.width,(b.maxY-b.minY+36)/height);
        if(scale>1)viewer.camera.zoomOut(range*(scale-1));
        b=bounds();
        const metersPerPixel=2*range*scale*Math.tan(viewer.camera.frustum.fovy/2)/box.height;
        viewer.camera.moveRight(((b.minX+b.maxX)/2-box.width/2)*metersPerPixel);
        viewer.camera.moveDown(((b.minY+b.maxY)/2-(top+bottom)/2)*metersPerPixel);
        request();
      },
    });
  }
  function setBasemap(type) {
    viewer.imageryLayers.removeAll();
    const token = import.meta.env.VITE_TIANDITU_TOKEN;
    if (!token) callbacks.onMapError?.('尚未配置天地图访问密钥');
    else createTiandituLayers(token, type, () => callbacks.onMapError?.('底图请求失败，请检查天地图密钥、域名授权或网络')).forEach(l => viewer.imageryLayers.add(l));
    request();
  }
  function stopPreview() {
    if (frame) cancelAnimationFrame(frame); frame = null;
    if (moving) routes.entities.remove(moving); moving = null;
    callbacks.onPreview?.(false); request();
  }
  function preview() {
    if (frame) { stopPreview(); return; }
    const path = model?.plan?.path;
    if (!path?.length) return;
    const positions = path.map(p => LL([...p,is3D ? model.altitude : 4]));
    const distances = [0];
    for (let i=1;i<positions.length;i++) distances.push(distances.at(-1)+Cartesian3.distance(positions[i-1],positions[i]));
    const total=distances.at(-1), start=performance.now();
    moving=point(routes,[...path[0],is3D ? model.altitude : 4],'预览',WHITE);
    callbacks.onPreview?.(true);
    function tick(now) {
      const d=(now-start)/16000*total;
      if(d>=total){stopPreview();return;}
      let i=1; while(i<distances.length-1 && distances[i]<d)i++;
      moving.position=Cartesian3.lerp(positions[i-1],positions[i],(d-distances[i-1])/Math.max(.001,distances[i]-distances[i-1]),new Cartesian3());
      request();frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);
  }
  setBasemap('imagery');
  viewer.camera.setView({ destination: LL([113.948,22.5407,2300]),
    orientation: { heading:0, pitch:-(Math.PI/2-.0001), roll:0 } });
  let firstLoad = false;
  viewer.scene.globe.tileLoadProgressEvent.addEventListener(count => {
    if (count > 0) firstLoad = true;
    if (count === 0 && firstLoad) callbacks.onMapLoaded?.();
  });
  return {
    viewer, draw, fit, setMode, finish, setBasemap, preview,
    cancel: () => setMode(null), undo: () => { draft.pop();sketch(); },
    setPhotos: value => {showPhotos=value;photoPoints.show=value;request();},
    zoom: factor => {viewer.camera.zoomIn(viewer.camera.positionCartographic.height*factor);request();},
    north: () => viewer.camera.flyTo({destination:viewer.camera.position,orientation:{heading:0,pitch:viewer.camera.pitch,roll:0},duration:.5}),
    toggle3D: () => {is3D=!is3D;viewer.scene.screenSpaceCameraController.enableTilt=is3D;if(model)draw(model);fit();return is3D;},
    destroy: () => {stopPreview();handler.destroy();viewer.destroy();},
  };
}
