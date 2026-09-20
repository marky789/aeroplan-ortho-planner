# 航域 AeroPlan

面向 DJI Dock 3 / Matrice 4D、4TD 的网页航线预规划工具。用户在 Cesium 地图上绘制作业区，页面生成垂直摄影或 4D 正射三向近似摆拍规划，在线采样地形并生成固定离地高度的三维航线。

在线访问：[航域 AeroPlan](https://marky789.github.io/aeroplan-ortho-planner/)。

## 本地运行

需要 Node.js 22.12+ 或 24+。

```sh
npm install
npm run dev
```

打开 http://127.0.0.1:5173/ 。天地图浏览器密钥已保存在本机 `.env.local`，不写入规划导出文件。更换密钥时参考 `.env.example`，然后重启服务。天地图和字体服务需要网络，字体不可用时采用系统字体。

```sh
npm test
npm run build
npm run preview
```

生产构建输出至 `dist/`，预览地址为 http://127.0.0.1:4173/ 。应部署整个目录，包括其中 `cesium/` 下的静态资源。浏览器须支持 WebGL。

## GitHub Pages 部署

推送到 `main` 后，`.github/workflows/pages.yml` 自动执行算法测试、构建、部署路径测试并发布。Pages 使用 GitHub Actions 作为发布来源。

- 项目路径由 `VITE_BASE_PATH=/aeroplan-ortho-planner/` 指定；Vite 资源、规划 Worker 和 Cesium 资源统一使用此路径。本地开发默认 `/`。
- 天地图浏览器密钥配置于仓库 Actions Secret `VITE_TIANDITU_TOKEN`，构建时注入，不提交 `.env.local`。这是浏览器端访问密钥，会出现在公开网页资源和天地图请求中；如密钥设置域名限制，需要允许 `marky789.github.io`。
- 修改部署路径后，应使用相同环境变量执行构建、测试和预览。例如 PowerShell：

```powershell
$env:VITE_BASE_PATH = '/aeroplan-ortho-planner/'
npm run build
npm run test:deployment
npm run preview
```

此时本地预览地址为 http://127.0.0.1:4173/aeroplan-ortho-planner/ 。结束后移除该环境变量即可恢复根路径构建。

## 操作

1. 点击“绘制作业区”，单击地图添加顶点，以 Enter、右键或“完成绘制”结束。Esc 取消，Backspace 撤销当前绘制点。完成后可拖动外边界点。
2. 点击“排除区”绘制内部孔洞；连接线会绕开孔洞。排除区必须完全位于外边界内，不能相交或接触。
3. 选择实际相机模式，修改固定离地高度、航速、重叠率和沿线地形采样间距，系统自动重算。可手动调整主航向或启用交叉网格。
4. 点击“拍照点”显示采集位置，点击“航线预览”播放压缩时间的轨迹示意。3D 显示在线地形和逐点赋高航线；三向模式开启拍照点时显示首站近似足迹。
5. 导出规划 JSON 或采集站高度 CSV，预览后下载或复制完整内容。JSON 可以再次导入；草稿保存在当前浏览器本地。若内嵌浏览器不接收下载，可复制完整内容保存，或在常规浏览器中打开本地地址下载。

支持单个 GeoJSON Polygon，包括内部环。`examples/深圳示例作业区.geojson` 可用于导入演示。已声明的坐标系仅接受 EPSG:4490 或 EPSG:4326 经纬度；WGS84 经纬度按近似位置导入并提示未做测绘级基准转换。GCJ-02、BD-09、墨卡托米制坐标需要事先正确转换。

## 坐标 地形与高度

底图仍使用天地图 EPSG:4490 的 img_c/cia_c 或 vec_c/cva_c，WMTS 矩阵 1 对应 Cesium level 0，GRS80 椭球和局部 AEQD 用于水平计算。

真实在线地形使用 [Mapzen Terrain Tiles / AWS Open Data](https://registry.opendata.aws/terrain-tiles/)，无需新增密钥。Terrarium 高程按 `R*256+G+B/256-32768` 解码，固定 13 级采样，跨瓦片双线性插值并处理像素中心。地图和数字采样同源，保留来源版权。

**飞行绝对高程 = 地形源高程 + altitude（固定 AGL）**。地形是多源正高，不是经转换的椭球高或国家高程；Cesium 使用源高程数值作近似显示，导入飞机前必须处理基准转换。WGS84 地形索引与 4490 边界未作测绘级水平转换。

高度不再考虑 buildingHeight、dockHeight、clearance；旧草稿中的这些参数会被丢弃。机场仅保留位置标记。地形数据不包含完整建筑 DSM，不进行建筑避障。

## 两阶段航线算法

1. Web Worker 校验边界和参数，AEQD 米制扫描并裁剪凹区和孔洞，往复排序，补齐下视平面足迹遗漏，再以可视图最短路径连接。
2. 沿拍摄与转场路线加密，保留所有采集站及连接拐点；在线地形采样成功后逐点赋高，计算三维距离和时间。旧任务的异步结果不会覆盖新参数。

```text
k = 2 * tan(对角FOV / 2) / hypot(像宽px, 像高px)
地面名义GSD(cm/px) = AGL * k * 100
航线间距 = AGL * k * 像宽px * (1 - 旁向重叠率)
采集站距 = AGL * k * 像高px * (1 - 航向重叠率)
飞行绝对高程 = 在线地形高程 + AGL
三维距离 = sum(sqrt(dx*dx + dy*dy + dz*dz))
```

默认地形采样间距 30m，可设 5–100m，最多 50000 个唯一采样点；每批 256 点。请求超时或高程缺失会停止生成和导出，不以 0m 代替。采样点之间线性连接，采样密度不等于 DEM 精度，也不能保证连续净空。

总边界顶点 180、测区轴向跨度 30km、4000 拍摄航段、15000 预算照片为容量上限。自动航向仍每 15° 估算水平距离和转弯代价，未重新用地形或风向做全局最优搜索。

## 4D 正射三向近似摆拍

`captureMode=smartOrtho` 仅对 4D 开放；切到 4TD 自动恢复垂直拍摄。用户确认的近似参数：侧视俯仰 `smartPitch=-62.5°`（可调 −65° 至 −60°），左偏航 −27.5°、右偏航 +27.5°（`smartYaw` 幅度可调 25° 至 30°），横滚为 0°；中间垂直向下。

相机射线与采集站地形高程处的水平面求交，生成三向足迹模板。足迹并未与真实坡面或建筑求交；仍保留下视间距控制覆盖，不直接扩大行距。站点坐标与 `captureRequests` 表示采集意图；`captureModel` 保存用户近似姿态，原生 `nativeAngles/nativeTiming` 为 null。三向照片数按站数三倍作预算，区内时间未计原生摆拍周期。

大疆作业指南说明正射三向摆拍仅 M4D 支持，并提示可能降低最终正射质量。这里的角度来自用户近似输入，不表示已复刻 DJI 原生飞行任务。

## 导出与适用范围

JSON v2 的 `planningStatus=terrain-sampled-unverified`。所有路线与采集站坐标为 `[经度,纬度,绝对高程]`，`heightReference` 明确源正高和未作椭球高转换。CSV 每采集站一行，分别列出地形源高程、飞行绝对高程、AGL、模式和预算照片数。

当前不生成 WPML / KMZ 可执行文件，不校核建筑、树木、线缆、机场进出、水平净空、转弯半径、飞行性能、风、电量或真正射成果完整性。三维坡度和所需爬降速度只作提示。

## 实现与验证

- `src/planner.js` 与 worker：水平规划。
- `src/capture-geometry.js`：近似姿态与射线足迹。
- `src/terrain-source.js`：开放地形解码、缓存、采样和地图 provider。
- `src/terrain-route.js`：米制加密、逐点赋高与三维统计。
- `src/mission-export.js`：有基准标记的 JSON 和 CSV。
- `src/main.js` / `src/map.js`：交互与地图。
- `docs/AeroPlan航线生成算法与参数说明.docx`：详细算法和算例。

`npm test` 覆盖全部 `src/*.test.js` 与 `docs/*.test.js`。部署前再构建并执行 `npm run test:deployment`。Cesium 固定 1.139.0，engine 23.0.1 / widgets 14.4.0，保留锁文件。
