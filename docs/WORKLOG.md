# WORKLOG — 工作日志

> 每次会话的工作日志。新会话开工前先读这个文件。

---

## 会话 1 · 2026-10-15

**目标**：按 `manchester-city-demo-plan.md` 开始模型构建（P1 垂直切片 → P3 球场）

### 做了什么

**P0/P1 数据管线（全部跑通）**

- 建立项目骨架：Vite 8.3.4 + three 0.186.1（均为当时最新稳定版，方案说"以 npm 当时最新为准"）
- `scripts/fetch-osm.mjs`：分片 + 串行 + 429/5xx 指数退避 + 断点续传 + 三镜像轮换
- `scripts/build-city-json.mjs`：DP 简化 1.5m → 顶点吸附 2m → 高度量化 4m 阶梯 → ll2xy 投影 → 紧凑 JSON
- P1 区域（老特拉福德 1km²）实测：**233 栋建筑 / 568 段道路 / 40 段铁路 / 3 块水面 / 64 块绿地**，city.json 61 KB

**P2 渲染层**

- `core/geo.js` 投影（全项目唯一坐标换向点）
- `core/materials.js` 共享色板（≤8 色，风格锚点）
- `city/` 三环 LOD（A 环精确挤出 / B 环简化 / C 环只留大体量），每环合并成 1 个 draw call
- 地面 + 100m 网格、道路带状几何、水系、绿地

**P3 球场**

- 程序化草坪 canvas 贴图（14 条条纹 + 全套白线 + 中圈/禁区/罚球弧/角球弧）
- 参数化碗形看台（八边形近似圆角），每排 = 竖板（混凝土）+ 座面（座椅色）
- 座椅海 InstancedMesh、悬挑屋顶、四角灯塔
- 老特拉福德：四块独立大顶 + 角部开口（`roofSegments: [0,2,4,6]`），红座椅海
- 伊蒂哈德：连续环形顶，浅蓝座椅海

**验证（Chrome 155 无头 + CDP）**

- 配准：两球场实测距离 **6419 m，误差 0.0 m** ✅
- 朝向：老特拉福德 yaw 19.37°，伊蒂哈德 yaw -69.90°（来自实测，见 DECISIONS.md D-001）✅
- 性能：**121 448 三角形 / 27 draw calls**（预算 60 万 / 200，余量充足）✅
- 三张验证截图：`docs/shot-ot.png`、`docs/shot-overview.png`、`docs/shot-etihad.png`

### 卡在哪

（无 — 本次会话打通了全链路）

### 踩的坑（按发现顺序）

1. **Overpass 406**：本机网络环境直连被拒，开代理后解决。另发现 `overpass.osm.ch` 数据不全（返回空 elements），不能当备胎。
2. **Overpass 504**：带正则的查询（`["name"~"Etihad",i]`）容易超时，改用简单 bbox 查询。
3. **多边形质心公式写错**：分母误用了无符号面积，导致 233 栋建筑里 153 栋被分错环、直接丢弃。标准公式分母必须是**有符号**面积。
4. **InstancedMesh frustum culling**：默认用"单个盒子"的包围球做剔除，球场整体远离原点时整个座椅海被剔除。必须 `frustumCulled = false`。
5. **`building=stadium` 陷阱（最隐蔽的一个）**：OSM 里老特拉福德的四个看台是四个独立的 `building=stadium` way（Sir Alex Ferguson / West / East / Sir Bobby Charlton Stand）。分类函数把它们当普通建筑挤出，**正好盖在整个程序化球场上**——表现是"座椅海永远看不见"。修复：分类时排除 `building=stadium` / `leisure=stadium`。
6. **gltf 根节点 rotation_mode = QUATERNION**：设置 `rotation_euler` 完全无效（静默失败），必须先切 `XYZ`。
7. **Blender 之外的新教训 —— 不要靠眼睛调 3D 场景**：预览图的显示增强会骗人（本会话中把"其实已经是深棕色"看成"还是浅色"）。**正确做法是读像素值做定量判断**。这个方法论在曼彻斯特项目里同样适用：验收标准全部量化（配准误差、三角形数、draw calls），不靠"看起来对"。

### 下一步

- [ ] P2：把 bbox 扩到全域（`node scripts/fetch-osm.mjs full`），验证 6-8 万栋建筑下的 60fps
- [ ] P4：相机 Tour（CatmullRomCurve3 分镜）+ 昼夜切换 + UI
- [ ] P5：彩蛋（键入 1999 / 1000）+ 部署

---

## 会话 2 · 2026-10-15（同日，第二段）

**目标**：P2 全域数据 + P4 相机叙事 / 昼夜 / UI

### 做了什么

**P2 全域数据 ✅**

- `node scripts/fetch-osm.mjs full`：bbox 7.8 × 13.3 km，15 片全抓完（65 MB 原始）
- 全域构建结果：**61 800 栋建筑 / 37 845 段道路 / 1 403 段铁路 / 147 块水面 / 305 段水道 / 8 579 块绿地**
- city.json 6.7 MB（gzip 1.65 MB），与方案预估的 4-8 MB 一致
- **性能验收通过：518 557 三角形 / 28 draw calls**（预算 60 万 / 200）
- LOD 分环：A 环 1 031 / B 环 7 728 / C 环 3 325 / 按规则丢弃 49 716（方案 §6.3 的 C 环丢弃规则生效）

**P4 相机叙事 + 昼夜 + UI ✅**

- `camera/tour.js`：CatmullRomCurve3 位置曲线 + lookAt 曲线 + 章节字幕表，全数据表驱动
- 6 个章节：高空开场 → 沿运河飞向老特拉福德 → 梦剧场红座椅海 → Metrolink 穿市中心 → 伊蒂哈德蓝座椅海 → 全城鸟瞰收尾
- `core/daynight.js`：两套预烘焙状态 2s lerp，不做实时太阳
- `city/nightLights.js`：城市窗光 InstancedMesh（每栋 2~4 个暖黄小方块）
- UI：一键 Tour / 昼夜切换 / 自由视角 / 章节字幕；用户拖动立刻中断 Tour

**部署准备 ✅**

- `vite build` 通过，JS 包体 **615 KB（gzip 158 KB）**

### 卡在哪

（无）

### 新踩的坑

1. **Tour 单位不匹配（静默失败）**：主循环传给 `tour.update()` 的是**毫秒**，`TOUR_DURATION` 是**秒**，结果 `t` 每帧加 0.2，Tour 一帧播完、相机直接跳到终点。修法：单位统一成秒。这类"数值在动但幅度离谱"的问题，先查单位。
2. **窗光被埋进实心几何体**：建筑是实心挤出棱柱，把窗光放在 0.45~0.95 倍楼高处正好落在实体内部，完全不可见。修法：贴到楼顶上方。
3. **水平面片在低机位下不可见**：窗光用水平 PlaneGeometry，相机低角度时侧对相机、投影面积趋近 0。改成小方块，任意角度至少露出一个面。
4. **city.json 内联进 JS 包体的部署陷阱**：`import cityJson from './data/city.json'` 会让 Vite 把 6.7 MB JSON 打进 bundle，JS 变 6.9 MB，手机端解析卡死。改成放 `public/` 运行时 `fetch()`，JS 包体 6.9 MB → **615 KB**。
5. **无头 Chrome 的 `--virtual-time-budget` 对 CPU 密集任务无效**：虚拟时钟只快进定时器，不等几何构建。改用 CDP（`--remote-debugging-port` + WebSocket）轮询页面就绪后再截图。

### 下一步

- [x] P5：彩蛋（键入 1999 / 1000）+ 录屏 ← 彩蛋已实现，录屏待用户自己录
- [x] 部署准备（`vite build` 通过，`dist/` 就绪）
- [ ] 部署上线（GitHub Pages 或 sites 技能）
- [ ] 手机实测 + 画质分级

---

## 会话 3 · 2026-10-15（同日，第三段）

**目标**：P5 彩蛋 + 部署准备

### 做了什么

- `egg/egg.js` + `egg/legends.js`：
  - 键入 **1999** → 老特拉福德上空升起金色奖杯（scale 缓动 + 自转）+ 字幕"补时 3 分钟 · 诺坎普之夜"
  - 键入 **1000** → 全城 6 组红蓝烟花（5400 粒子 Points）+ 双雄传奇墙逐条淡入上移 + 字幕"THIS IS MANCHESTER"
  - 传奇名录按方案附录 D（曼联 23 人 / 曼城 10 人），只显示姓名文字，不用队徽（§6.9 商标边界）
- `vite build` 通过：**JS 621 KB（gzip 160 KB）**，dist 共 7.7 MB
- 彩蛋功能测试通过（CDP 模拟键盘输入）：
  - 1999 → 奖杯 visible=true, scale 0.80（正在升起），字幕正确
  - 1000 → 烟花 visible=true, opacity 0.87，字幕正确；截图实测 1440 个红色粒子

### 新踩的坑

1. **CanvasTexture 不支持无头 Chrome 的虚拟时钟**：`--virtual-time-budget` 只快进定时器，不等 canvas 绘制和几何构建。改用 CDP 轮询 `#loading` 消失后再截图（见 /tmp/shot2.mjs 模式）。
2. **Chrome 无头截图是 RGB（3 字节）不是 RGBA**：手写 PNG 解码时要用 IHDR 里的 color type 算 stride，否则数组越界。

### 下一步

- [ ] 手机实测 + 画质分级（IS_MOBILE 判定已写好）
- [ ] 录屏成片（OBS，Tour 模式 + 手动环绕，60-90 秒）

---

## 会话 5 · 2026-10-15 · 部署上线

**目标**：项目上传 GitHub 并开启 GitHub Pages 在线预览。

### 做了什么

- 本地仓库初始化（`.gitignore` 排除 node_modules / dist / data/raw），41 文件 / 4.7 MB，提交 `fce8126`
- 通过 GitHub Desktop 推送到 `github.com/MUFC-Joy/manchester-demo`
- 添加 Pages 自动部署工作流 `.github/workflows/deploy.yml`（提交 `1d95750`）：推送 main 即云端 `vite build` 并部署 dist/
- 仓库改公开 + Pages Source 选 GitHub Actions（用户在网页端操作）
- 上线验证（无头浏览器实测 https://mufc-joy.github.io/manchester-demo/ ）：
  - HTTP 200，JS 包 622 KB / city.json 正常加载
  - 控制台日志与本地一致：配准误差 0.0 m，LOD 分环 A 1031 / B 7728 / C 3325
  - 像素统计：绿 45.8%（地面/绿地）、灰 19.3%（建筑/道路）、蓝 18.6%（天空/水系）、红 0.39%（球场座椅）——渲染完整
  - 实拍截图存档：`docs/shot-live.png`

### 卡在哪

- shell 里的 git 推送用了过期凭据（macOS 钥匙串里的旧 token），推送统一走 GitHub Desktop 图形端解决
- GitHub API 未认证请求限流（403 rate limit），验证改用公开 API 的缓存间隙完成

### 下一步

- [ ] 手机实测 + 画质分级（IS_MOBILE 判定已写好）
- [ ] 录屏成片（OBS，Tour 模式 + 手动环绕，60-90 秒）
- [ ] 可选：自定义域名 / README 补线上链接与截图

---

## 会话模板（复制这段开始新日志）

```
## 会话 N · 日期

**目标**：

### 做了什么

### 卡在哪

### 下一步

- [ ]
```
