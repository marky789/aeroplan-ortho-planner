import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { createIcons, ScanLine, Check, CircleHelp, Download, ChevronDown, FileJson, Table2, ArrowUpRight, Pentagon, Upload, Undo2, Trash2, Grid2x2, RefreshCw, MapPin, Layers, SquareDashed, MapPinPlus, Camera, X, Scan, Compass, Plus, Minus, Play, Pause, Info, ArrowRight } from 'lucide';
import { createMap } from './map.js';
import { validatePolygon, validateOptions } from './planner.js';
const icons={ScanLine,Check,CircleHelp,Download,ChevronDown,FileJson,Table2,ArrowUpRight,Pentagon,Upload,Undo2,Trash2,Grid2x2,RefreshCw,MapPin,Layers,SquareDashed,MapPinPlus,Camera,X,Scan,Compass,Plus,Minus,Play,Pause,Info,ArrowRight};

// Visual thesis: a quiet ivory inspector beside an edge-to-edge satellite workspace,
// with one jade accent for the operation being planned.
// Content: mission and area -> capture parameters -> route review -> portable export.
// Interaction: live drawing, restrained camera transitions, and an explicit route preview.
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const $ = id => document.getElementById(id);
const sample = [[113.9458,22.5424],[113.9512,22.5427],[113.9514,22.5404],[113.9492,22.5403],[113.9491,22.5387],[113.9455,22.5389]];
const defaults = {camera:'4D',altitude:100,dockHeight:40,buildingHeight:40,clearance:20,frontOverlap:85,sideOverlap:80,speed:6,heading:0,autoHeading:true,crossGrid:false,turnSeconds:3};
let state = { name:'南山科技园航测', ring:sample, holes:[], dock:[113.94625,22.54185], options:{...defaults}, demo:true };
const validDock=p=>p===null || (Array.isArray(p) && p.length>=2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0])<=180 && Math.abs(p[1])<85);
try {
  const saved=JSON.parse(localStorage.getItem('aeroplan-mission-v1')||'null');
  if(saved && Array.isArray(saved.ring) && saved.options && validDock(saved.dock) && (saved.ring.length===0 || validatePolygon(saved.ring,saved.holes||[]).valid)) state={name:String(saved.name||'未命名任务').slice(0,60),ring:saved.ring,holes:saved.holes||[],dock:saved.dock,options:validateOptions(saved.options),demo:saved.demo===true};
} catch { /* An unavailable or old local draft does not prevent planning. */ }
let map, plan=null, drawing=null, timer, toastTimer, job=0, history=[], pendingExport=null;
const worker=new Worker(new URL('./planner.worker.js',import.meta.url),{type:'module'});

$('app').innerHTML=`
  <header class="app-header">
    <a class="brand" href="./" aria-label="航域首页"><span class="brand-mark">${icon('scan-line')}</span><strong>航域<span>AeroPlan</span></strong></a>
    <span class="header-divider"></span><span class="header-context">正射航线规划 <span class="beta">WORKSPACE</span></span>
    <div class="header-actions"><span class="draft-status" id="save-status">${icon('check')} 本地草稿</span>
      <button class="icon-button help-button" id="help" aria-label="操作指南">${icon('circle-help')}</button>
      <div class="export-wrap"><button class="button primary compact" id="export-toggle">${icon('download')} 导出方案 ${icon('chevron-down')}</button>
      <div id="export-menu" class="popover" hidden><button id="export-json">${icon('file-json')} 规划方案 JSON</button><button id="export-csv">${icon('table-2')} 拍照位置 CSV</button><small>规划数据 · 不直接下发飞行器</small></div></div>
    </div>
  </header>
  <main class="workspace">
    <aside class="inspector" aria-label="航线规划参数">
      <div class="inspector-scroll">
        <div class="mission-heading"><div><div class="eyebrow">MISSION PLANNER</div><h1>规划一次好航测<span class="heading-dot"></span></h1></div><span class="mission-number">01</span></div>
        <label class="field-label" for="mission-name">任务名称 <span id="demo-badge" class="tag">示例</span></label>
        <input id="mission-name" class="text-input mission-name" maxlength="60" aria-label="任务名称">
        <section class="control-section area-section">
          <div class="section-heading"><h2><span>01</span> 作业区域</h2><button id="load-sample" class="text-button">载入示例 ${icon('arrow-up-right')}</button></div>
          <button id="draw" class="button primary draw-button">${icon('pentagon')} 绘制作业区 <kbd>D</kbd></button>
          <div class="area-actions"><button id="import" class="button subtle">${icon('upload')} 导入范围</button><button id="undo" class="icon-button" aria-label="撤销操作" title="撤销">${icon('undo-2')}</button><button id="clear" class="icon-button" aria-label="清空作业区" title="清空">${icon('trash-2')}</button></div>
          <input id="import-file" type="file" accept=".json,.geojson" hidden>
          <div class="area-description"><span id="vertex-count">6 个边界点</span><span id="hole-count">无排除区域</span></div>
        </section>
        <section class="control-section">
          <div class="section-heading"><h2><span>02</span> 采集设置</h2><span class="section-note">垂直摄影</span></div>
          <label class="field-label" for="camera">相机预设</label><div class="select-wrap"><select id="camera"><option value="4D">Matrice 4D · 广角 20 MP</option><option value="4TD12">Matrice 4TD · 广角 12 MP</option><option value="4TD48">Matrice 4TD · 广角 48 MP</option></select>${icon('chevron-down')}</div>
          <div class="two-fields"><label class="field-label" for="altitude">对地航高<div class="number-wrap"><input id="altitude" type="number" min="20" max="500" step="5"><span>m</span></div></label><label class="field-label" for="speed">拍摄速度<div class="number-wrap"><input id="speed" type="number" min="1" max="15" step=".5"><span>m/s</span></div></label></div>
          <div class="range-heading"><label for="frontOverlap">航向重叠率</label><output id="front-output">85<span>%</span></output></div><input id="frontOverlap" type="range" min="60" max="95" step="1">
          <div class="range-heading"><label for="sideOverlap">旁向重叠率</label><output id="side-output">80<span>%</span></output></div><input id="sideOverlap" type="range" min="50" max="95" step="1">
        </section>
        <section class="control-section">
          <div class="section-heading"><h2><span>03</span> 航线布局</h2><label class="switch-label"><input type="checkbox" id="autoHeading"><span class="switch"></span>自动航向</label></div>
          <div class="range-heading"><label for="heading">主航线方向</label><output id="heading-output">自动</output></div><input id="heading" type="range" min="0" max="175" step="5">
          <label class="option-row" for="crossGrid"><span>${icon('grid-2x2')}<span><strong>交叉网格</strong><small>增加第二方向的垂直拍摄</small></span></span><input type="checkbox" id="crossGrid"><span class="switch"></span></label>
        </section>
        <details class="advanced" open><summary>高度与净空 ${icon('chevron-down')}</summary>
          <div class="two-fields"><label class="field-label" for="dockHeight">机场离地高度<div class="number-wrap"><input id="dockHeight" type="number" min="0" max="500" step="1"><span>m</span></div></label><label class="field-label" for="buildingHeight">最高建筑高度<div class="number-wrap"><input id="buildingHeight" type="number" min="0" max="500" step="1"><span>m</span></div></label></div>
          <label class="field-label" for="clearance">要求的垂直净空<div class="number-wrap"><input id="clearance" type="number" min="5" max="200" step="5"><span>m</span></div></label>
          <p class="field-hint">均相对测区地面。间距按最高建筑表面估算；请用实测高度替换示例值。</p>
        </details>
      </div>
      <div class="inspector-footer"><span class="engine-dot"></span><span id="compute-status">参数变化后自动更新</span><button id="recompute" class="icon-button" aria-label="重新计算">${icon('refresh-cw')}</button></div>
    </aside>
    <section class="map-workspace" aria-label="Cesium 航线地图">
      <div id="cesium-container"></div>
      <div class="map-top"><div class="location-chip">${icon('map-pin')}<span id="location-title">南山科技园 · 示例区域</span><span class="location-divider"></span><span>CGCS2000</span></div>
        <div class="basemap-control"><label class="sr-only" for="basemap">底图类型</label>${icon('layers')}<select id="basemap"><option value="imagery">卫星影像</option><option value="vector">矢量地图</option></select></div>
      </div>
      <div class="map-tools"><button id="tool-area" title="绘制作业区" aria-label="绘制作业区">${icon('pentagon')}<span>作业区</span></button><button id="tool-hole" title="绘制排除区域" aria-label="绘制排除区域">${icon('square-dashed')}<span>排除区</span></button><button id="tool-dock" title="标记机场位置" aria-label="标记机场位置">${icon('map-pin-plus')}<span>机场</span></button><span class="tool-divider"></span><button id="toggle-photos" aria-label="拍照点" title="显示拍照点" aria-pressed="false">${icon('camera')}<span>拍照点</span></button></div>
      <div id="drawing-guide" class="drawing-guide" hidden><span class="pulse-dot"></span><span id="drawing-text">单击添加边界点</span><button id="finish-draw" disabled>完成绘制 <kbd>Enter</kbd></button><button id="cancel-draw" class="icon-button" aria-label="取消绘制">${icon('x')}</button></div>
      <div class="map-navigation"><button id="fit" aria-label="定位作业区" title="定位作业区">${icon('scan')}</button><button id="north" aria-label="朝向正北" title="朝向正北">${icon('compass')}</button><span></span><button id="zoom-in" aria-label="放大">${icon('plus')}</button><button id="zoom-out" aria-label="缩小">${icon('minus')}</button><span></span><button id="view-mode" aria-pressed="false" title="切换三维示意">3D</button></div>
      <div class="map-legend"><span><i class="legend-line"></i>拍摄航段</span><span><i class="legend-dash"></i>区内连接</span><span id="view-note" hidden>高度示意 · 地面参考0m</span></div>
      <div class="mission-review"><div class="review-heading"><div><span class="review-dot"></span><strong id="plan-title">正在生成航线</strong><span class="review-subtitle" id="plan-subtitle">基于最高建筑高度计算影像重叠</span></div><button id="preview" class="preview-button">${icon('play')} 航线预览</button></div>
        <div class="metrics"><div><span>作业面积</span><strong id="metric-area">—<small>ha</small></strong></div><div><span>区内航程</span><strong id="metric-distance">—<small>km</small></strong></div><div><span>区内用时</span><strong id="metric-time">—<small>min</small></strong></div><div><span>预计照片</span><strong id="metric-photos">—<small>张</small></strong></div><div><span>地面 GSD</span><strong id="metric-gsd">—<small>cm/px</small></strong></div></div>
        <details class="quality-details"><summary><span>${icon('info')}平面规划 · 建筑遮挡与机场进出路径待校核</span>${icon('chevron-down')}</summary><div id="quality-content"></div></details>
      </div>
      <div class="map-footer"><span><i class="status-dot" id="tile-dot"></i><span id="tile-status">正在加载天地图</span></span><span id="coordinates">113.948000° E &nbsp; 22.540700° N</span><span>CGCS2000 / EPSG:4490</span></div>
      <div id="map-error" class="map-error" role="status" hidden></div>
    </section>
  </main>
  <div id="toast" class="toast" role="status" hidden></div>
  <dialog id="export-dialog"><div class="dialog-heading"><h2>导出规划数据</h2><button id="close-export" class="icon-button" aria-label="关闭导出">${icon('x')}</button></div><p id="export-filename"></p><label class="field-label" for="export-preview">文件内容预览</label><textarea id="export-preview" readonly spellcheck="false"></textarea><p>此文件用于保存和交换规划数据，不直接下发飞行器。</p><div class="export-dialog-actions"><button id="copy-export" class="button subtle">复制完整内容</button><button id="save-export" class="button primary">${icon('download')} 下载文件</button></div></dialog>
  <dialog id="help-dialog"><div class="dialog-heading"><h2>从一个区域，开始规划</h2><button id="close-help" class="icon-button" aria-label="关闭指南">${icon('x')}</button></div><ol><li><strong>绘制作业区</strong><p>点击地图添加边界点，按 Enter、右键或点击“完成绘制”闭合。支持凹多边形；完成后可拖动边界点。</p></li><li><strong>设置拍摄参数</strong><p>选择实际机型，填写对地航高和建筑高度。修改参数后会自动重新生成航线。</p></li><li><strong>检查与导出</strong><p>开启拍照点或播放航线，检查区内连接。可导出规划 JSON 和拍照位置 CSV，JSON 可重新导入。</p></li></ol><div class="help-note">当前采用平面与最高建筑高度估算，未接入 DSM、实时障碍物或空域数据，不生成可直接执行的大疆飞行文件。排除区不允许区内连接穿越。</div><button id="got-it" class="button primary">开始规划 ${icon('arrow-right')}</button></dialog>
`;
createIcons({icons});
function notify(message) { $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3800); }
function save() { try {localStorage.setItem('aeroplan-mission-v1',JSON.stringify(state));}catch{} }
function remember(){history.push(structuredClone(state));if(history.length>30)history.shift();}
function syncInputs(){
  $('mission-name').value=state.name;
  Object.entries(state.options).forEach(([key,value])=>{const el=$(key);if(el){if(el.type==='checkbox')el.checked=value;else el.value=value;}});
  $('demo-badge').hidden=!state.demo;
  $('location-title').textContent=state.demo?'南山科技园 · 示例区域':'当前作业区域';
  updateLabels();
}
function updateLabels(){
  $('front-output').textContent=`${state.options.frontOverlap}%`;
  $('side-output').textContent=`${state.options.sideOverlap}%`;
  $('heading-output').textContent=state.options.autoHeading?(plan?`${plan.heading.toFixed(0)}° · 自动`:'自动'):`${state.options.heading}°`;
  $('heading').disabled=state.options.autoHeading;
  for(const key of ['frontOverlap','sideOverlap','heading']) {const el=$(key);el.style.setProperty('--range-fill',`${(Number(el.value)-Number(el.min))/(Number(el.max)-Number(el.min))*100}%`);}
  $('vertex-count').textContent=state.ring.length?`${state.ring.length} 个边界点`:'尚未绘制作业区';
  $('hole-count').textContent=state.holes.length?`${state.holes.length} 个排除区域`:'无排除区域';
}
function refreshMap(){map?.draw({ring:state.ring,holes:state.holes,dock:state.dock,plan,altitude:state.options.altitude,dockHeight:state.options.dockHeight});}
function displayPlan(){
  const s=plan?.stats;
  const metric=(id,value,unit)=>{$(id).innerHTML=`${value}<small>${unit}</small>`;};
  metric('metric-area',s?(s.areaM2/10000).toFixed(2):'—','ha');
  metric('metric-distance',s?(s.distanceM/1000).toFixed(2):'—','km');
  metric('metric-time',s?(s.durationSeconds/60).toFixed(1):'—','min');
  metric('metric-photos',s?s.photoCount.toLocaleString():'—','张');
  metric('metric-gsd',s?s.gsdCm.toFixed(2):'—','cm/px');
  $('preview').disabled=!plan;$('export-toggle').disabled=!plan;
  if(s){
    $('plan-title').textContent=`已生成 ${s.legCount} 段拍摄航线`;
    $('plan-subtitle').textContent=`航线间距 ${s.lineSpacingM.toFixed(1)} m · 拍照间距 ${s.shotSpacingM.toFixed(1)} m`;
    $('quality-content').replaceChildren();
    const basics=document.createElement('p');basics.textContent=`估算楼顶净空 ${s.minClearanceM.toFixed(1)} m；相对机场高度 ${s.relativeDockHeightM.toFixed(1)} m。统计仅包含区域内飞行，不含机场往返。`;$('quality-content').append(basics);
    for(const message of plan.warnings){const p=document.createElement('p');p.textContent=message;$('quality-content').append(p);}
  }else{$('quality-content').replaceChildren();$('plan-title').textContent=state.ring.length?'等待有效规划参数':'绘制区域，自动生成航线';$('plan-subtitle').textContent='可绘制任意不自交的多边形';}
  updateLabels();refreshMap();
}
function schedule(immediate=false){
  clearTimeout(timer);
  const id=++job;plan=null;displayPlan();save();
  if(state.ring.length<3){$('compute-status').textContent='等待绘制作业区';return;}
  $('compute-status').textContent='正在计算航线…';$('plan-title').textContent='正在生成航线';
  timer=setTimeout(()=>worker.postMessage({id,ring:state.ring,holes:state.holes,options:state.options}),immediate?0:220);
}
worker.onmessage=({data})=>{
  if(data.id!==job)return;
  if(data.error){plan=null;displayPlan();$('compute-status').textContent='请调整范围或参数';$('plan-title').textContent='暂时无法生成航线';$('plan-subtitle').textContent=data.error;notify(data.error);return;}
  plan=data.plan;$('compute-status').textContent='航线已更新';displayPlan();
};
worker.onerror=()=>{$('compute-status').textContent='规划器未就绪，请刷新重试';notify('规划器加载失败，请刷新页面');};
map=createMap('cesium-container',{
  onCoordinate:p=>{$('coordinates').textContent=`${p[0].toFixed(6)}° E   ${p[1].toFixed(6)}° N`;},
  onMode:mode=>{drawing=mode;$('drawing-guide').hidden=!mode;$('drawing-text').textContent=mode==='dock'?'点击地图标记机场位置':'单击添加边界点 · 右键完成 · Esc 取消';$('finish-draw').hidden=mode==='dock';['tool-area','tool-hole','tool-dock'].forEach((id,i)=>$(id).classList.toggle('active',mode===['area','hole','dock'][i]));$('draw').classList.toggle('is-drawing',!!mode);},
  onDraft:count=>{$('finish-draw').disabled=count<3;if(drawing && drawing!=='dock')$('drawing-text').textContent=`已添加 ${count} 个点 · 右键完成 · Esc 取消`;},
  onComplete:(type,ring)=>{
    const nextRing=type==='area'?ring:state.ring,nextHoles=type==='area'?[]:[...state.holes,ring];
    const check=validatePolygon(nextRing,nextHoles);
    if(!check.valid){notify(check.error||check.errors?.[0]||'范围无效，请检查边界');return false;}
    remember();state.ring=nextRing;state.holes=nextHoles;state.demo=false;syncInputs();schedule(true);return true;
  },
  onDock:p=>{remember();state.dock=p;save();refreshMap();notify('已标记机场，进出路径需另行校核');},
  onVertexMove:(i,p)=>{const next=state.ring.map((point,index)=>index===i?p:point);const check=validatePolygon(next,state.holes);if(!check.valid){notify('移动后的边界无效，已恢复');refreshMap();return;}remember();state.ring=next;state.demo=false;syncInputs();schedule();},
  onMapError:message=>{$('tile-status').textContent='底图连接异常';$('tile-dot').classList.add('warning');$('map-error').textContent=message;$('map-error').hidden=false;},
  onMapLoaded:()=>{if(!$('map-error').hidden)return;$('tile-status').textContent=$('basemap').value==='imagery'?'天地图影像':'天地图矢量';$('tile-dot').classList.remove('warning');$('tile-dot').classList.add('ready');},
  onPreview:playing=>{$('preview').innerHTML=`${icon(playing?'pause':'play')} ${playing?'停止预览':'航线预览'}`;createIcons({icons,root:$('preview')});},
});
function begin(type){if(type==='hole'&&state.ring.length<3){notify('请先绘制作业区');return;}map.setMode(type);}
$('draw').onclick=() => begin('area');$('tool-area').onclick=()=>begin('area');$('tool-hole').onclick=()=>begin('hole');$('tool-dock').onclick=()=>begin('dock');
$('finish-draw').onclick=()=>map.finish();$('cancel-draw').onclick=()=>map.cancel();
$('undo').onclick=()=>{if(drawing){map.undo();return;}const previous=history.pop();if(previous){state=previous;syncInputs();schedule(true);}else notify('没有可撤销的操作');};
$('clear').onclick=()=>{remember();map.cancel();state.ring=[];state.holes=[];state.demo=false;syncInputs();schedule(true);};
$('load-sample').onclick=()=>{remember();map.cancel();state={name:'南山科技园航测',ring:structuredClone(sample),holes:[],dock:[113.94625,22.54185],options:{...defaults},demo:true};syncInputs();schedule(true);map.fit(state.ring);};
$('mission-name').oninput=event=>{state.name=event.target.value;save();};
for(const key of ['camera','altitude','speed','frontOverlap','sideOverlap','heading','autoHeading','crossGrid','dockHeight','buildingHeight','clearance']) {
  const el=$(key);el.addEventListener(el.type==='range'?'input':'change',()=>{
    if(el.type==='number'&&(!el.value||!el.checkValidity())){el.value=state.options[key];notify('请输入范围内的有效数值，已恢复上次设置');return;}
    state.options[key]=el.type==='checkbox'?el.checked:key==='camera'?el.value:Number(el.value);updateLabels();schedule();
  });
}
$('recompute').onclick=()=>schedule(true);
$('basemap').onchange=()=>{$('map-error').hidden=true;$('tile-status').textContent='正在切换底图';map.setBasemap($('basemap').value);};
$('fit').onclick=()=>map.fit();$('north').onclick=()=>map.north();$('zoom-in').onclick=()=>map.zoom(.35);$('zoom-out').onclick=()=>map.zoom(-.45);
$('view-mode').onclick=()=>{const enabled=map.toggle3D();$('view-mode').textContent=enabled?'2D':'3D';$('view-mode').setAttribute('aria-pressed',String(enabled));$('view-note').hidden=!enabled;};
$('toggle-photos').onclick=()=>{const enabled=$('toggle-photos').getAttribute('aria-pressed')!=='true';$('toggle-photos').setAttribute('aria-pressed',String(enabled));map.setPhotos(enabled);};
$('preview').onclick=()=>map.preview();
$('help').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();$('got-it').onclick=()=>$('help-dialog').close();
$('export-toggle').onclick=()=>$('export-menu').hidden=!$('export-menu').hidden;
document.addEventListener('click',event=>{if(!event.target.closest('.export-wrap'))$('export-menu').hidden=true;});
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);$('export-menu').hidden=true;}
function offerExport(content,name,type){pendingExport={content,name,type};$('export-filename').textContent=name;$('export-preview').value=content.slice(0,16000)+(content.length>16000?'\n…（预览已截断，下载和复制包含完整内容）':'');$('export-menu').hidden=true;$('export-dialog').showModal();}
$('close-export').onclick=()=>$('export-dialog').close();
$('save-export').onclick=()=>{if(pendingExport)download(pendingExport.content,pendingExport.name,pendingExport.type);};
$('copy-export').onclick=async()=>{if(!pendingExport)return;try{await navigator.clipboard.writeText(pendingExport.content);$('copy-export').textContent='已复制完整内容';setTimeout(()=>$('copy-export').textContent='复制完整内容',2200);}catch{notify('复制未获浏览器支持，请使用下载文件');}};
function filename(){return (state.name||'航线方案').replace(/[\\/:*?"<>|]/g,'-');}
$('export-json').onclick=()=>{if(!plan)return;offerExport(JSON.stringify({format:'aeroplan',version:1,crs:'EPSG:4490',planningStatus:'unverified',...state,plan,notes:['高度相对测区参考地面，非椭球高。','无DSM遮挡或机场进出路线校核，非可执行飞行文件。']},null,2),`${filename()}.json`,'application/json');};
$('export-csv').onclick=()=>{if(!plan)return;const rows=['序号,经度_CGCS2000,纬度_CGCS2000,相对测区地面高度_m'];plan.photos.forEach((p,i)=>rows.push(`${i+1},${p[0].toFixed(9)},${p[1].toFixed(9)},${state.options.altitude}`));offerExport('\uFEFF'+rows.join('\r\n'),`${filename()}-拍照位置.csv`,'text/csv;charset=utf-8');};
$('import').onclick=()=>$('import-file').click();
$('import-file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>3*1024*1024)throw new Error('请导入小于3MB的范围文件');
    const data=JSON.parse(await file.text());let ring,holes=[], importedOptions, importedDock;
    const crs=typeof data.crs==='string'?data.crs:data.crs?.properties?.name;
    if(crs && !/EPSG(?::|::)(4490|4326)$/i.test(crs))throw new Error('仅支持 CGCS2000 或 WGS84 经纬度，不能导入墨卡托或偏移坐标');
    if(data.format==='aeroplan'){importedOptions=validateOptions(data.options||{});importedDock=data.dock??null;if(!validDock(importedDock))throw new Error('机场坐标无效');}
    if(data.format==='aeroplan'){ring=data.ring;holes=data.holes||[];}
    else {if(data.type==='FeatureCollection'&&data.features?.length!==1)throw new Error('请将多个作业区拆分为单个 Polygon 文件');const geometry=data.type==='Feature'?data.geometry:data.type==='FeatureCollection'?data.features?.[0]?.geometry:data;if(geometry?.type!=='Polygon')throw new Error('请选择包含单个 Polygon 的 GeoJSON');[ring,...holes]=geometry.coordinates;}
    const normalized=points=>points.length>1&&points[0][0]===points.at(-1)[0]&&points[0][1]===points.at(-1)[1]?points.slice(0,-1).map(p=>p.slice(0,2)):points.map(p=>p.slice(0,2));
    ring=normalized(ring);holes=holes.map(normalized);const check=validatePolygon(ring,holes);if(!check.valid)throw new Error(check.error||check.errors[0]);
    remember();map.cancel();state.ring=ring;state.holes=holes;state.demo=false;
    if(data.format==='aeroplan'){state.name=String(data.name||'导入任务').slice(0,60);state.options=importedOptions;state.dock=importedDock;}else state.name=file.name.replace(/\.(geo)?json$/i,'').slice(0,60);
    syncInputs();schedule(true);map.fit(ring);notify(data.format!=='aeroplan'&&!/4490$/.test(crs||'')?'已导入经纬度范围；WGS84 未做测绘级基准转换，请核对边界。':'已导入作业范围');
  }catch(error){notify(`导入失败：${error.message}`);}finally{event.target.value='';}
};
document.addEventListener('keydown',event=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName)||$('help-dialog').open||$('export-dialog').open)return;
  if(event.key==='Escape')map.cancel();
  if(event.key==='Enter'&&drawing){event.preventDefault();map.finish();}
  if(event.key==='Backspace'&&drawing){event.preventDefault();map.undo();}
  if(event.key.toLowerCase()==='d')begin('area');
});
syncInputs();schedule(true);map.fit(state.ring,0);
window.addEventListener('beforeunload',()=>{worker.terminate();map.destroy();});
