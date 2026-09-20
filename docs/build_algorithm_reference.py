"""Build the Chinese algorithm reference using the Codex bundled Python runtime."""
from pathlib import Path
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'AeroPlan航线生成算法与参数说明.docx'
doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.top_margin, sec.bottom_margin = Cm(1.8), Cm(1.7)
sec.left_margin = sec.right_margin = Cm(1.9)
sec.footer_distance = Cm(.8)
for name in ['Normal', 'Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Caption']:
    style = doc.styles[name]
    style.font.name = 'Calibri'
    style._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
    style.font.color.rgb = RGBColor(0, 0, 0)
    style.font.size = Pt(10.5)
    style.paragraph_format.space_after = Pt(6)
    style.paragraph_format.line_spacing = 1.16
doc.styles['Title'].font.size = Pt(23)
doc.styles['Subtitle'].font.italic = False
for border in list(doc.styles.element.iter(qn('w:pBdr'))):
    border.getparent().remove(border)
doc.styles['Heading 1'].font.size = Pt(17)
doc.styles['Heading 2'].font.size = Pt(12)
doc.styles['Heading 1'].paragraph_format.space_after = Pt(12)
doc.styles['Heading 2'].paragraph_format.space_before = Pt(8)
doc.styles['Caption'].font.size = Pt(9)
footer = sec.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
footer.add_run('AeroPlan 算法说明  ·  ')
field = OxmlElement('w:fldSimple'); field.set(qn('w:instr'), 'PAGE'); footer._p.append(field)
for run in footer.runs: run.font.size = Pt(8)
doc.core_properties.title = 'AeroPlan航线生成算法与参数说明'
doc.core_properties.subject = '输入输出定义 计算流程 复算示例 实现边界'
doc.core_properties.author = 'AeroPlan 项目'

def p(text, style=None):
    return doc.add_paragraph(text, style)
def h(text): doc.add_heading(text, 2)
def page(title):
    doc.add_page_break()
    doc.add_heading(title, 1)
def eq(text):
    para = doc.add_paragraph()
    para.paragraph_format.space_after = Pt(7)
    math = OxmlElement('m:oMath')
    run = OxmlElement('m:r'); txt = OxmlElement('m:t'); txt.text = text
    run.append(txt); math.append(run); para._p.append(math)
def code(text):
    para = p(text)
    para.paragraph_format.line_spacing = 1.05
    for run in para.runs: run.font.name = 'Consolas'; run.font.size = Pt(9)
def table(headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers)); t.alignment = WD_TABLE_ALIGNMENT.CENTER; t.autofit = False
    props = t._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for side in ['top','left','bottom','right','insideH','insideV']:
        el = OxmlElement('w:'+side); el.set(qn('w:val'),'single'); el.set(qn('w:sz'),'4'); el.set(qn('w:color'),'D9D9D9'); borders.append(el)
    props.append(borders)
    for c,w in zip(t.columns,widths): c.width = Cm(w)
    for i, values in enumerate([headers] + rows):
        row = t.rows[0] if i == 0 else t.add_row()
        trpr = row._tr.get_or_add_trPr()
        keep = OxmlElement('w:cantSplit'); trpr.append(keep)
        if i == 0: trpr.append(OxmlElement('w:tblHeader'))
        for j,(cell,value) in enumerate(zip(row.cells,values)):
            cell.width = Cm(widths[j]); cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            tcpr = cell._tc.get_or_add_tcPr(); margins = OxmlElement('w:tcMar')
            for side in ['top','bottom','left','right']:
                el=OxmlElement('w:'+side); el.set(qn('w:w'),'75'); el.set(qn('w:type'),'dxa'); margins.append(el)
            tcpr.append(margins)
            fill = OxmlElement('w:shd'); fill.set(qn('w:fill'),'DBE5EE' if i == 0 else ('F4F7FA' if i%2 == 0 else 'FFFFFF')); tcpr.append(fill)
            para=cell.paragraphs[0]; para.paragraph_format.space_after=Pt(1); para.paragraph_format.line_spacing=1.08
            run=para.add_run(str(value)); run.font.size=Pt(9)
            run.bold=(i==0)
    p('').paragraph_format.space_after=Pt(0)
    return t

p('AeroPlan 航线生成算法\n与参数说明', 'Title')
p('城市正射影像采集预规划技术文档', 'Subtitle')
p('代码基线 a1c1cb4  |  编制日期 2026年9月20日')
p('本项目将用户绘制的单个多边形作业区转换为有序拍摄航段、拍照位置和区内连接路径。算法采用局部米制投影、相机视场角估算、扫描线裁剪、平面覆盖补线及可视图最短路径，支持凹多边形和内部排除区。')
p('本文用于理解、复算和维护当前项目。它说明各参数如何影响结果，并给出可直接运行的调用示例。所有“已实现”描述均对应上述代码版本。')
h('适用范围')
p('当前结果是平面参考条件下的采集预规划。系统以统一的最高建筑高度计算拍摄间距，尚未使用 DSM 校核建筑遮挡和三维障碍物，因此不能据此保证真正射影像完整性，也不生成可直接下发大疆机场的飞行任务。')
table(['阅读内容','对应章节'],[
 ['接口与参数','第 2 至 3 章  输入定义 相机预设 坐标与高度'],
 ['核心计算','第 4 至 9 章  几何校验 间距 扫描 航向 补线 连接'],
 ['结果解释','第 10 至 11 章  拍照点 统计 输出与导出'],
 ['复算与维护','第 12 至 14 章  算例 错误边界 代码与测试']], [4.2,13])
h('完整处理链')
p('参数与多边形校验 → 局部投影 → 相机足迹和间距 → 候选航向扫描 → 航向选择 → 平面足迹补线 → 边界内连接 → 拍照点插值 → 距离时间统计 → 经纬度输出。')
p('机场在楼顶时，必须统一测区参考地面、建筑高度和机场高度的基准。机场位置目前仅用于界面展示和方案保存，没有进入区内航线优化。')

page('2 输入接口与规划参数')
code('planMission(ringLL, options = {}, holesLL = [])')
p('ringLL 是外边界经纬度数组；holesLL 是内部排除区数组；options 是参数对象。坐标顺序始终为 [经度, 纬度]，单位为度。坐标点可附带第三个分量，但算法清洗时只保留前两个分量。首尾可闭合，也可不重复首点。')
table(['字段','默认值','单位与引擎约束'],[
 ['camera','4D','字符串  4D / 4TD12 / 4TD48'],
 ['altitude','100','m  相对参考地面的航高  0 < H ≤ 1000'],
 ['buildingHeight','40','m  最高建筑高度  ≥ 0'],
 ['dockHeight','40','m  机场高度  ≥ 0'],
 ['clearance','20','m  要求的垂直净空  ≥ 0'],
 ['frontOverlap','85','%  航向重叠率  50 至 95'],
 ['sideOverlap','80','%  旁向重叠率  50 至 95'],
 ['speed','6','m/s  0 < speed ≤ 25'],
 ['heading','0','°  任意有限数  使用前归一化到 [0,180)'],
 ['autoHeading','true','布尔值  是否搜索 12 个候选方向'],
 ['crossGrid','false','布尔值  是否增加正交的第二遍扫描'],
 ['turnSeconds','3','s  每两个相邻拍摄航段间的附加时间  0 至 60']], [4.1,2.2,10.9])
p('数值必须是有限的 JavaScript Number，不能用数值字符串、NaN 或 Infinity。两个开关必须是真正的布尔值。传入部分 options 时，其余字段沿用默认值；未知扩展字段目前不会参与核心计算。')
h('参数之间的联合约束')
eq('H − B > 0     且     H − B ≥ clearance')
p('H 表示 altitude，B 表示 buildingHeight。净空不满足时立即报错；机场高度高于航高只触发提示，不会阻止生成区内航线。目标 GSD 目前不是独立输入，系统由航高反算 GSD。')

page('3 相机预设与坐标高度约定')
table(['相机键','照片像素','对角视场角','参考最短间隔'],[
 ['4D','5280 × 3956','84°','0.5 s'],
 ['4TD12','4032 × 3024','82°','0.7 s'],
 ['4TD48','8064 × 6048','82°','0.7 s']], [2.8,5.4,3.8,5.2])
p('以上为代码内置预设，最短间隔用于 JPEG 模式参考提示。采用标称对角视场角和像素长宽比估算成像几何，未使用标定焦距、主点、畸变参数或实际裁切尺寸。4TD 的两种预设具有相同足迹，48 MP 模式的名义 GSD 为 12 MP 模式的一半；这不等同于实际有效分辨率保证。')
h('经纬度与局部平面')
p('输入输出使用 CGCS2000 经纬度语义，底图使用 EPSG:4490。几何计算先通过 proj4 转到 GRS80 椭球上的局部等距方位投影 AEQD，单位为米。投影中心是外边界顶点经纬度的算术平均值，不是面积重心。')
code('+proj=aeqd +lat_0=中心纬度 +lon_0=中心经度\n+ellps=GRS80 +units=m +no_defs')
p('局部坐标 x 表示东西方向，y 表示南北方向。航向按局部投影北方向顺时针计量：0° 为南北向，90° 为东西向。局部投影距离用于面积、间距和路径长度，不能理解为在所有地点均无误差的大地测量距离。')
h('统一的高度参考')
eq('最高建筑上方高度 h = altitude − buildingHeight')
eq('相对机场高度 = altitude − dockHeight')
p('三项高度都相对同一测区参考地面。它们不是椭球高、海拔高或自动读取的地形高。机场位于屋顶时，不能直接把测区对地航高当成机场起飞点的相对高度。当前算法不求解机场至测区的爬升、下降或返航路径。')
h('界面范围与引擎范围')
p('网页控件设置得更窄：航高 20–500 m、速度 1–15 m/s、航向重叠率 60%–95%、建筑和机场高度 0–500 m、净空 5–200 m、手动方向 0°–175°。通过程序调用时，第 2 章引擎约束才是最终校验规则。')

page('4 多边形清洗与合法性校验')
h('第一步 清洗坐标')
p('每个点必须含有限经纬度，经度绝对值不超过 180°，纬度绝对值小于 85°。若首尾点的经纬度欧氏差小于 10⁻¹¹，则删除末尾重复点。每个环清洗后至少需要 3 个点，外环与所有孔洞的顶点总数最多 180。')
h('第二步 控制局部投影范围')
p('外环经度跨度不能超过 5°，因此不支持跨日期变更线的单一区域。投影后，外环 x 和 y 两方向的跨度分别不得超过 30 km。这是轴向跨度限制，不是面积或对角线长度限制。')
h('第三步 检查简单多边形')
p('每条边长度至少为 0.05 m；相邻边不得回折重叠；非相邻边不得相交或接触。每个环的面积至少为 1 m²。程序采用射线奇偶规则进行点包含判断，边界点单独标识为 0，内部为 1，外部为 −1。')
h('第四步 检查排除区')
p('每个孔洞必须严格位于外环内，不能与外环相交或接触。孔洞之间不能相交、接触或相互包含。外环和孔洞都不要求固定顺时针或逆时针排列。当前接口表示一个外环加多个孔洞，不表示多个互不相连的作业区。')
h('第五步 计算净作业面积')
eq('A环 = |Σ (xᵢ yᵢ₊₁ − xᵢ₊₁ yᵢ)| / 2')
eq('areaM2 = A外环 − Σ A孔洞')
p('这是投影平面上的鞋带公式面积，单位为平方米；不是地表起伏面积。几何处理中主要使用 EPS = 10⁻⁶ m 量级的容差，并对叉积按线段长度缩放；容差服务于数值稳健性，不代表测绘精度。')
code('validatePolygon(ringLL, holesLL)\n成功  { valid: true, errors: [], areaM2 }\n失败  { valid: false, error: "原因", errors: ["原因"] }')
p('planMission 遇到非法边界或非法参数时直接抛出 Error；validatePolygon 只检查几何并返回结果对象。')

page('5 相机足迹与拍摄间距计算')
p('假设相机垂直向下、成像面平行于水平参考面，照片长边横跨航线、短边沿航线。设像素宽高为 Nw、Nh，对角视场角为 α，地面航高为 H，最高建筑高度为 B。')
h('步骤一 求单位高度对应的像素尺度')
eq('dpx = √(Nw² + Nh²)')
eq('k = 2 tan(απ / 360) / dpx')
p('k 的量纲为每米高度对应的米每像素。απ/360 将半视场角转换为弧度。先由对角视场角得到对角足迹，再按像素长宽比分配为宽和长。')
h('步骤二 求地面与屋顶名义分辨率')
eq('gsdCm = 100 H k')
eq('roofGsdCm = 100 (H − B) k')
p('两个输出单位均为 cm/px。由于屋顶更接近相机，其足迹更小；项目使用最高建筑平面决定间距，用来避免只按地面足迹布线造成屋顶重叠不足。')
h('步骤三 求屋顶足迹和目标间距')
eq('W = (H − B) k Nw     L = (H − B) k Nh')
eq('lineSpacingM = W (1 − sideOverlap / 100)')
eq('shotSpacingM = L (1 − frontOverlap / 100)')
p('W 是横跨航线的足迹宽度，L 是沿航线的足迹长度。两个 spacing 输出是用于生成航线和拍照点的目标最大间距。为均匀排布并包含端点，实际行距和点距通常更小。')
h('参数变化的影响')
p('增加建筑高度或提高重叠率会减小间距，通常增加航段数和照片量。提高航高会扩大足迹、增大 GSD；调整速度不改变拍照点数量，但会改变时间估算和拍摄间隔提示。对复杂边界，航段数和时间可能出现离散跳变。')

page('6 扫描线裁剪与往复式排序')
h('步骤一 将多边形旋转到扫描坐标')
p('设航向 θ 已转换为弧度。u 沿飞行方向，v 垂直于飞行方向。此变换为正交坐标变换，其逆变换形式相同。')
eq('u = x sinθ + y cosθ     v = x cosθ − y sinθ')
eq('x = u sinθ + v cosθ     y = u cosθ − v sinθ')
h('步骤二 均匀布置扫描行')
eq('n = max(1, ceil((vmax − vmin) / lineSpacingM))')
eq('Δv = (vmax − vmin) / n')
eq('vⱼ = vmin + (j + 0.5) Δv     j = 0 … n−1')
p('vmin 和 vmax 取外环顶点的极值。第一行距外包范围的一侧为半个实际行距，最后一行距另一侧同样为半行距。这里的 n 是扫描行数；一个扫描行穿过凹区或孔洞时，可形成多个拍摄航段。')
h('步骤三 求扫描线与所有边的交点')
eq('u交点 = uₐ + (vⱼ − vₐ)(uᵦ − uₐ) / (vᵦ − vₐ)')
p('仅当 vₐ ≤ vⱼ < vᵦ 或 vᵦ ≤ vⱼ < vₐ 时计入交点。半开区间避免扫描线穿过顶点时重复计数，与扫描线平行的边不参与上述求交。')
p('将外环和所有孔洞的交点一起按 u 排序，并按第 1–2、第 3–4 个交点依次成对。奇偶规则保留作业区内部区间，同时剔除孔洞和凹陷外部。长度不大于 EPS 的区间被忽略。')
h('步骤四 形成往复式顺序')
p('扫描行按 v 从小到大排列。第 0 行从较小 u 飞向较大 u，第 1 行反向，之后逐行交替。奇数行不仅反转每个航段的端点，也反转同行多段的访问顺序。此阶段只确定顺序，跨段连接随后单独计算。')
code('一行交点  a < b < c < d\n保留区间  [a,b] 与 [c,d]\n中间区间  (b,c) 属于孔洞或区域外部')

page('7 自动航向与双网格计算')
h('手动航向')
eq('heading = ((输入角度 mod 180) + 180) mod 180')
p('180° 周期描述航线轴向，往返航段的实际行进方向由排序决定。因此 heading 不是每个航段的飞机机头角，接口也没有输出逐点 yaw 指令。')
h('自动航向')
p('autoHeading 为 true 时，依次测试 0°、15°、30°，直到 165°，共 12 个候选方向。每个候选先生成常规扫描航段，再计算近似时间代价，选择严格小于当前最优代价的方案；完全相等时保留先遇到的方向。')
eq('C(θ) = (Σ L拍摄 + Σ D端点直连) / speed')
eq('             + max(0, 航段数 − 1) × turnSeconds')
p('D端点直连是相邻拍摄航段之间的欧氏直线距离。评分阶段未进行孔洞绕行，也未加入后续补线，因而评分与最终路线时间可能不同。此搜索是离散启发式选择，不是全局最短航线求解。')
h('双网格')
p('crossGrid 为 true 时，每个候选同时生成 θ 和 (θ + 90°) mod 180° 两组扫描航段，先完成第 1 遍，再完成第 2 遍。两遍合并后参与代价计算；最终会分别补线，并计算从第一遍末点到第二遍首点的区内连接。')
table(['情况','当前实现'],[
 ['风向与侧风','未进入候选评分'],
 ['机场位置与出入方向','未参与起点或终点选择'],
 ['补线与孔洞绕行','选定方向后处理，未重新搜索航向'],
 ['连接路径','最终路径按允许区域校核'],
 ['两遍同位置照片','独立保留，不跨遍去重']], [5,12.2])
p('双网格提供两个方向的平面采集结构，但没有计算真实地物可见性和多视交会条件。需要真正射成果时，不能仅凭开启双网格认定建筑遮挡问题已经解决。')

page('8 平面足迹覆盖检查与补线')
p('常规均匀扫描可能漏过位于两行之间的细长突出部。completeFlatCoverage 在选定方向后检查近似照片足迹的并集，发现遗漏时补充扫描行；双网格的每一遍独立执行此过程。')
h('步骤一 构造每个航段的覆盖矩形')
eq('R = [umin − L/2, umax + L/2] × [v行 − W/2, v行 + W/2]')
p('L 和 W 来自第 5 章屋顶足迹。因为拍照点包含航段两端，且实际沿线点距不大于足迹长度，在固定平面、固定朝向模型内，这一串照片足迹的并集是连续矩形。矩形可以延伸到飞行边界或孔洞之外。')
h('步骤二 建立横向扫描事件')
p('事件包括全部多边形顶点的 v 坐标，以及落在区域纵向范围内的覆盖矩形上下边。排序后，对每个宽度大于 2EPS 的相邻事件区间，检查中点、下边上方和上边下方三个位置。靠近边界的偏移量取 min(区间宽度/4, 10EPS)。')
h('步骤三 判定尚未覆盖的区间')
p('在检查位置 v 上重新求多边形内部区间。取该位置穿过的覆盖矩形，按左端点排序并求其区间并集。若任一作业区间中出现超过 EPS 的空隙，则判定该检查位置存在平面足迹遗漏。')
h('步骤四 插入补充扫描行并迭代')
p('发现遗漏后，在该 v 处生成完整扫描行，包括这一行的全部合法区间，而不是只生成遗漏的一个短段。立即将新矩形加入覆盖集合，并在下一轮重建事件。直到无补线产生，再统一重新执行往复式排序。')
p('补线行数每遍最多 360，循环索引为 0 至 180；超过航段上限、无法生成有效补线或不能在有限轮次内完成时，返回错误，要求简化或拆分区域。coverageAddedRows 记录新增扫描行数，不是新增航段数。')
h('覆盖结论的边界')
p('此过程针对带数值容差的近似平面足迹至少一次覆盖。它没有验证边缘所需的多张影像重叠、立体重建质量或建筑遮挡，也没有外扩作业边界补拍。排除区限制飞机路径，不表示相机画面不会拍到该区域。')

page('9 区内连接与孔洞绕行')
p('相邻拍摄航段之间不直接无条件连线。createNavigator 在外边界内、孔洞内部之外寻找连接折线。外边界和孔洞边界允许经过，当前没有向内或向外施加水平安全偏移。')
h('步骤一 判断直线可见性')
p('先检查两个端点均处于允许区域，再求连接线段与全部边界边的交点参数 t。把 t=0、t=1 和交点参数排序，对每个非退化子区间的中点检查区域归属。只要有中点位于外环之外或孔洞内部，这条连接线就不可直接使用。')
h('步骤二 建立边界顶点可视图')
p('若端点可直连，立即返回两个点。否则以外环和所有孔洞顶点为节点，逐对检查可见性；可见的节点对建立无向边，边权为米制欧氏距离。边界基础图按一次任务缓存，不对每条连接重复构建。')
h('步骤三 接入起终点并运行最短路径')
p('把前一拍摄航段终点和后一航段起点加入图，与可见的边界顶点相连。Dijkstra 算法每轮在线性数组中选择未访问的最低成本节点，松弛其邻边，最后通过前驱节点反向还原连接折线。找不到路径则报错。')
code('navigate(上一航段.end, 下一航段.start)\n可直连 → [start, end]\n不可直连 → 可视图 → Dijkstra → [start, 转折点…, end]')
h('最短的具体含义')
p('这里求的是固定两端点之间、二维允许区域内的折线路径。在零缓冲多边形模型下，可视图适用于绕凹角与孔洞；它不重新排列拍摄航段，也不优化整次任务的访问顺序。')
h('工程限制')
p('飞机可在结果中贴边经过并在多边形顶点急转。算法未约束最小转弯半径、加速度、侧向净空或三维障碍物。起降场进出路线与返航路线不属于 connections。大量顶点会增加两两可见性测试开销，因此项目限制总顶点数并在 Web Worker 内计算。')
p('基础图在朴素实现下约需 O(V³) 几何工作量：O(V²) 对节点，每对可见性检查扫描边界。实际耗时还取决于航段、补线和连接数量，此量级描述不是性能承诺。')

page('10 拍照点与任务统计')
h('拍照点均匀插值')
p('对长度为 S 的每条拍摄航段，先计算间隔数 K，再产生 K+1 个位置。即使航段很短，也至少生成首尾两个拍照点。')
eq('K = max(1, ceil(S / shotSpacingM))')
eq('Pⱼ = P起 + (j/K)(P终 − P起)     j = 0 … K')
eq('实际点距 = S/K ≤ shotSpacingM')
p('插值在局部米制平面完成，再逆投影为经纬度。photos 按航段顺序展开，不去重；连接折线上不额外生成拍照点。实际点距除以速度得到参考拍摄间隔，若最小值小于相机预设间隔，只生成警告，不自动降速或切换停悬拍照。')
h('距离和时间')
eq('captureDistanceM = Σ 拍摄航段长度')
eq('transitDistanceM = Σ 连接折线各边长度')
eq('distanceM = captureDistanceM + transitDistanceM')
eq('durationSeconds = distanceM / speed')
eq('                   + max(0, legCount − 1) × turnSeconds')
p('附加时间按“相邻拍摄航段之间”计一次，不按每个绕行转折点计时。基础行进时间对拍摄和连接统一使用 speed；未计入机场往返、起降、爬升、加减速、风和电池储备，不能直接推导可完成架次。')
h('照片量和路径容量')
p('补线后先汇总预计照片数量，超过 15000 张则报错；最终拍摄航段总数不能超过 4000。预检查在真正建立全部输出点之前执行，以控制浏览器计算和内存负担。')
h('总路径的组成')
p('path 从第一条拍摄航段起点开始，依次添加拍摄终点、连接折线后续节点和下一航段终点。它是用于显示的路线折线，不是 photos 的别名，也不是含时间、云台、速度和动作的飞行控制指令。')

page('11 输出数据结构与导出格式')
table(['顶层字段','类型与含义'],[
 ['heading','Number  主航向  [0,180) 度'],
 ['legs','Array  每项 {id, pass, start, end, photos}'],
 ['connections','Array  每项 {positions}  相邻拍摄段的连接折线'],
 ['photos','Array<[lon,lat]>  按任务顺序展开的拍照位置'],
 ['path','Array<[lon,lat]>  拍摄与转场合并的展示路径'],
 ['stats','Object  统计值  见下表'],
 ['warnings','String[]  近似条件和执行限制提示']], [4.1,13.1])
p('legs.id 从 1 连续编号；pass 为 1 或 2；start、end 与 photos 中的点均为二维经纬度。connections 数量通常为 legCount−1，positions 至少包含两端点。高度保存在输入 options 中，不附加到这些坐标数组。')
table(['stats 字段','单位与意义'],[
 ['areaM2','m²  外环减孔洞的净面积'],
 ['distanceM / captureDistanceM / transitDistanceM','m  区内总距离 / 拍摄距离 / 连接距离'],
 ['photoCount / legCount','张 / 段  照片数与拍摄航段数'],
 ['coverageAddedRows','行  各遍新增扫描行合计'],
 ['durationSeconds','s  统一速度与段间预留时间估算'],
 ['gsdCm / roofGsdCm','cm/px  参考地面 / 最高屋顶 GSD'],
 ['lineSpacingM / shotSpacingM','m  目标最大行距 / 目标最大点距'],
 ['minClearanceM / relativeDockHeightM','m  H−B / H−机场高度']], [8.4,8.8])
h('网页导出')
p('JSON 外层包括 format="aeroplan"、version=1、crs="EPSG:4490"、planningStatus="unverified"，以及任务名称、ring、holes、dock、options、demo、plan 和 notes。dock 坐标仅随方案保存。')
p('CSV 以 UTF-8 BOM 编码，列为序号、经度_CGCS2000、纬度_CGCS2000、相对测区地面高度_m；经纬度保留 9 位小数，高度取 options.altitude。JSON 和 CSV 均不是 DJI WPML 或 KMZ 飞行任务文件。')

page('12 可复算的矩形算例')
p('以 [116.39°,39.9°] 建立局部投影，将米制矩形 (0,0)、(300,0)、(300,200)、(0,200) 逆投影为经纬度输入。使用全部默认参数，只将 autoHeading 设为 false、heading 设为 90°。无孔洞，单网格。')
code("import { createLocalProjection, planMission } from './src/planner.js';\nconst f = createLocalProjection([[116.39, 39.9]]);\nconst ring = [[0,0],[300,0],[300,200],[0,200]].map(f.inverse);\nconst plan = planMission(ring, {autoHeading:false, heading:90});")
h('逐步计算')
p('① 4D 像素为 5280 × 3956，视场角 84°。H=100 m，B=40 m，因此屋顶相对高度为 60 m，满足 20 m 净空要求。')
p('② k≈0.0002729489325；地面 GSD≈2.729489 cm/px，屋顶 GSD≈1.637694 cm/px。屋顶足迹 W≈86.470222 m，L≈64.787159 m。')
p('③ 旁向 80%、航向 85%，所以目标行距≈17.294044 m，目标点距≈9.718074 m。200 m 横向范围需要 ceil(200/17.294044)=12 行，实际行距约 16.667 m。')
p('④ 每行约 300 m，K=ceil(300/9.718074)=31，生成 32 个点；实际点距约 9.677419 m，按 6 m/s 飞行约每 1.612903 s 拍一张。12 行合计 384 张，不需要补线。')
table(['结果','代码实算值'],[
 ['净面积','59999.999541 m²  约 6 ha'],
 ['拍摄航段 / 连接 / 照片','12 段 / 11 条连接 / 384 张'],
 ['拍摄距离','3599.999973 m'],
 ['连接距离','183.338734 m'],
 ['区内总距离','3783.338707 m'],
 ['预计时间','3783.338707 / 6 + 11 × 3\n= 663.556451 s  约 11.059274 min'],
 ['建筑净空 / 相对机场高度','60 m / 60 m']], [6.1,11.1])
p('引擎会按矩形经纬度顶点均值重新建立局部投影，因此实际投影矩形与最初的 300 × 200 m 坐标存在毫米量级差异。表中是代码实算值，手工矩形估算应保留合理容差。')

page('13 错误处理与真实采集边界')
table(['检查项','拒绝或提示条件'],[
 ['边界非法','自交 接触 重叠边 过短边 面积不足'],
 ['孔洞非法','出界 接触外环 相交 接触或嵌套其他孔洞'],
 ['范围与容量','顶点 >180  轴向跨度 >30 km\n航段 >4000  照片 >15000'],
 ['参数非法','非有限数 无效相机 非布尔开关 超出允许范围'],
 ['航高不足','H−B ≤0 或低于 clearance  直接报错'],
 ['拍照过快','实际最小点距/speed 小于参考间隔  仅提示'],
 ['机场高于航线','H ≤dockHeight  提示单独规划出场下降路线'],
 ['补线或连接失败','要求简化区域 拆分作业区或调整排除区']], [4.6,12.6])
h('当前已实现')
p('支持合法凹多边形、多个内部孔洞、固定平面单网格或双网格扫描、细长区域近似足迹补线、二维区内连接、逐段均匀拍照点与统计。天地图和 Cesium 提供交互与显示，不参与照片间距或最短连接的计算。')
h('真正射采集仍需补充的能力')
p('DSM 与建筑模型应参与每张照片的可见性检查，识别街巷、屋顶边缘和高楼之间的遮挡；需要按重建目标检查多视覆盖，而不仅是足迹并集。相机标定、真实照片模式和定位精度也需进入质量设计。')
p('飞行执行还需要水平净空、转弯半径、机场进出与返航、起降爬升、速度和动作约束、风与电量分架次，以及适配大疆任务格式的导出和验证。这些是后续工程能力，不是当前算法返回成功时已经完成的检查。')
h('坐标导入注意点')
p('网页支持单个 GeoJSON Polygon，并接受 EPSG:4490 或 EPSG:4326 经纬度标记；WGS84 输入没有执行测绘级基准转换，会提示核对边界。不要把 GCJ-02、BD-09 偏移坐标或 Web Mercator 米制坐标直接当作本接口经纬度。')

page('14 实现定位与验证方法')
table(['源码位置','职责'],[
 ['src/planner.js  32 行','createLocalProjection  建立 GRS80 局部投影'],
 ['src/planner.js  105 和 140 行','preparePolygon / validateOptions  校验输入'],
 ['src/planner.js  157 行','cameraGeometry  GSD 与间距'],
 ['src/planner.js  170 至 206 行','scanFrame / orderScanRows / makeScan  扫描裁剪排序'],
 ['src/planner.js  225 行','completeFlatCoverage  足迹并集补线'],
 ['src/planner.js  277 和 286 行','approximateCost / createNavigator  评分与连接'],
 ['src/planner.js  349 行','planMission  组织计算并生成输出'],
 ['src/planner.worker.js','接收 {id,ring,options,holes}\n返回 {id,plan} 或 {id,error}'],
 ['src/main.js','绘制与参数输入  220 ms 防抖  方案保存与导出']], [6.6,10.6])
p('行号对应代码基线 a1c1cb4。网页通过递增任务编号忽略过时的 Worker 返回值，避免旧结果覆盖新参数；这并不取消 Worker 已开始的旧计算。')
h('相关测试')
p('src/planner.test.js 覆盖投影往返、矩形统计、凹区与孔洞连接、非法几何、屋顶间距、窄区域、双网格、自动航向、容量上限、输入不可变性及细长突出部覆盖等 13 项。docs/algorithm-reference.test.js 对本文矩形算例新增回归验证，约束照片数、航段数、主要统计值和舍入容差。')
code('node --test src/planner.test.js docs/algorithm-reference.test.js\nnpm run build\nnpm run test:deployment')
p('自动测试验证的是实现行为和特定几何样例，不能替代真实场景试飞、影像质量检验或完整的飞行安全校核。修改相机预设、坐标变换或规划算法后，应同步重算本文示例和更新测试。')
h('项目与来源')
p('仓库  https://github.com/marky789/aeroplan-ortho-planner')
p('在线项目  https://marky789.github.io/aeroplan-ortho-planner/')
p('相机预设在代码中的资料引用  https://enterprise.dji.com/dock-3/specs')
p('本文的公式、流程、默认值与接口以项目源代码为准。相机资料链接用于追溯预设来源，实际执行前应匹配设备型号、固件和拍摄模式。')

doc.save(OUT)
print(OUT)
