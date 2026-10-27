# 交接文档（HANDOFF）

> 写给"新开一个对话"的接续者：读完这一份就能直接开工，不需要翻历史。
> 最后更新：2026-10-27 20:20（P0 成绩卡已完成）

---

## 0. 一句话现状

参赛作品「**灵巧手抓取挑战 / DexKinetics**」已完成 **首页 + 游戏主体 + 手势实验室 + 摄像头模式 + 成绩卡（四维雷达 / 人格称号 / 1080×1440 分享图）**，可玩、可跑、双端适配。
**剩余：隔空取物沙盒、发布上线、投稿物料。**

> 代码已纳入 git（基线 `387b3be`，P0 见 `e593b56`）。动 `engine.js` 之前先看 `git diff`。

---

## 1. 项目与命令

```
目录：C:\Users\16101\WorkBuddy\开发\grasp-challenge
栈：React 19 + Vite 6 + motion(framer-motion) + lucide-react，纯 CSS，无 UI 库
上游依据：SPEC.md（首页规格稿）、DESIGN.md（设计语言）——样式拿不准时看这两份，比本文档权威
```

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器 `http://127.0.0.1:5183`（**必须用后台方式启动，不能用管道/`&`，否则会被杀**） |
| `npm run build` | 产物在 `dist/` |
| `node tools/shot.mjs <url> <out.png> [waitMs] [w] [h] [--act=js] [--eval=js]` | 无头截图 + 注入脚本 + 取回表达式结果（已内置虚拟摄像头参数） |
| `node tools/vidsample.mjs` | 逐秒采样背景视频构图，用于测量画面内元素位置 |

## 2. 路由（hash 路由，`src/App.jsx`）

| hash | 页面 | 说明 |
|---|---|---|
| `#/` 或空 | 首页 Hero | 黑白极简 + 背景机械手视频（用户给的规格稿实现） |
| `#play` | 游戏页 | 抓取挑战主体，可玩 |
| `#gesture` | 手势实验室 | 摄像头 + 21 点骨架 + 实时数值 + 5 张手势卡 |
| `#lab` | 手部调参台 | 开发用，调机械手形态（`TUNING` 可视化） |

## 3. 文件地图

| 文件 | 职责 | 关键点 |
|---|---|---|
| `src/App.jsx` | 路由 + 首页 Hero | 首页按钮：Start Challenge → `#play`，How It Works → `#gesture` |
| `src/game/engine.js` | **游戏内核**（纯 JS + Canvas，不含 React） | 舞台 560×620；物体生成/下落/判定/计分/特效；`mode='slider'｜'camera'` |
| `src/game/camera.js` | MediaPipe 封装 | 懒加载引擎、两阶段校准、One Euro 滤波、fps/单帧耗时、可选 overlay |
| `src/Game.jsx` | 游戏页 UI | HUD、滑轨/拇指控制、时长选择、结算、摄像头模式与校准引导 |
| `src/scorecard.js` | **成绩卡**（纯逻辑 + Canvas） | 四维归一化、称号查表、1080×1440 分享图；`RANKS/rankOf/rateOf` 也在这里（Game.jsx 从这里 import，别再复制一份） |
| `src/Radar.jsx` | 结算页雷达 | 纯 SVG，和分享卡共用同一份 dims 数据 |
| `src/GestureLab.jsx` | 手势实验室 | 骨架绘制、五指伸直度、5 种手势判定（几何规则） |
| `src/CalibDemo.jsx` | 校准示范动画 | 用同一只机械手做"张开/握拳"循环 |
| `src/hand.js` | **机械手绘制** | 侧视双钳；`TUNING` 集中所有可调参数；`handTips()` 调试用 |
| `src/HandLab.jsx` | 调参台 | 五档 g 并排 + 滑块 |
| `src/styles.css` | 全部样式 | 极简黑白，胶囊组件，tabular-nums |
| `public/mp/` | MediaPipe wasm（39MB，三档） | **发布前必须裁剪成单档 SIMD** |
| `public/models/hand_landmarker.task` | 手部模型（7.5MB） | 本地加载，不依赖 Google CDN |

## 4. 关键参数（改手感先看这里）

**游戏（`engine.js` 顶部常量）**

```js
W = 560, H = 620            // 逻辑舞台
HAND = { x:176, y:267, scale:1.2 }
GRIP = { x:258, y:300 }     // 抓取点（滑轨模式固定）
ZONE_HALF = 30              // 抓取区上下各 30
HOLD_MS = 120               // 摄像头模式 100
GAP_MAX = 83                // g=1 时的开口像素
optG(d) = d / 83            // 物体直径 → 需要的开合度
tolG(d) = d<=26 ? 0.032 : 0.055   // 容差（摄像头模式 ×1.8）
下落速度 lerp(190, 400, p)   // p = t/duration
生成间隔 lerp(1.7, 0.62, p)
```

**评分**：`基分 × 精度倍率 × 连击倍率(上限3) + 完美+5`；3 次失误或时间到结束。
**评级按"每分钟得分"归一化**：2000 灵巧手 / 1400 黄金 / 900 白银 / 500 青铜。

**四维风格（`scorecard.js` 顶部常量）**：只影响成绩卡，**不参与判定和计分**
- 力度 = 抓取/捏碎时「接近过程峰值闭合速度」的均值 ÷ 基准（滑轨 `5.0 g/s`，摄像头 `2.6 g/s`）
- 精度 = `1 − 平均(|Δg|/tol)`，只有成功抓取才计入
- 胆量 = 接触易碎物时 `峰值速度 ÷ 该物体 fragile 阈值` 的均值（越接近 1 越冒险）
- 节奏 = `maxCombo ÷ 12`
- 称号：前缀看 `(力度+胆量)/2`，后缀看 `(精度+节奏)/2`，组合 16 种；一个都没抓住时直接给「手感未接通」

**手部形态（`hand.js` 的 `TUNING`）**：改动后跑 `#lab` 看五档，**开口必须单调收敛到 0~10**，否则说明拇指行程越界。

## 5. 已踩过的坑（别重复踩）

1. **Vite 不能 `import()` `public/` 下的文件**（报 500）。识别引擎用 `fetch` 取源码 + `Blob URL` 动态 import。
2. **镜像只能做一次**。坐标链：landmark 原始归一化 → 画布绘制视频时 `translate+scale(-1,1)` → 换算时`cw - x`。camera.js **不**预先翻转，否则骨架左右相反。
3. **识别循环里的异常必须就地兜住**。`raf = requestAnimationFrame(loop)` 若写在可能抛错的行之后，一次脏数据就让整条链路静默死掉（真实踩过）。
4. **`--virtual-time-budget` 对持续 rAF 的页面会冻结时钟**，截图里游戏不动。用 `tools/shot.mjs`（真实时钟）。
5. **rAF 的 dt 要防负值/异常**，否则游戏静默卡死。
6. **背景视频里的手会动**：8 秒内由下往上抬（t=0 占 58–89%，t=6 占 14–67%）。首页定位用「高度 80% + 下移 4%」才保证全程不裁切。
7. **竖屏画布 + 横屏摄像头用 cover 时**只有中间约 40% 宽度可见，手太靠边会被裁。
8. **「力度」不能取判定时刻的闭合速度**。抓取前要稳定保持 120ms，那时 speed≈0；必须记"接近过程里的峰值"，否则每个人的力度都是 0。
9. **统计用的闭合速度要用 3 帧均值求导**。直接用 `dgdt` 的话，摄像头模式的手抖会被记成"很用力"，力度虚高。
10. **结算浮层比别的浮层高**（多了雷达和按钮）。375×667 下靠 `overflow-y:auto + margin:auto` 兜住，`max-height:700px` 那条媒体查询会把 tagline 藏掉——是有意的，别当成 bug 调回来。
11. **Canvas 画中文前必须 `await document.fonts.load(...)`**。不等的话栅格化退回系统字，中英文基线会跳，导出的图和屏幕上看到的不一样。
12. **SVG 雷达的标签要按轴分别定位**，不能统一加 `dy`：底部标签会掉出 `viewBox` 被裁掉（踩过）。

## 6. 下一步（按优先级）

### P0 已完成 · 成绩卡（2026-10-27）
四维统计 → 称号 → 1080×1440 Canvas 分享图，结算页可预览 / 下载 / 长按保存。
**遗留的可调项（不影响功能，有空再动）**
- 力度基准 `5.0 / 2.6 g/s` 是估的，需要真人各跑几局校准，尤其摄像头模式
- 称号目前 16 种组合，可以先跑几局看实际分布，太集中再加维度

### P1 · 隔空取物沙盒（约 3h，用户已确认要做）
- 复用 `camera.js`（掌心坐标、开合度）+ `GestureLab` 的骨架绘制
- 物体在画面里漂浮，掌心靠近即吸附，握拳=抓住，张手=松开，甩手=抛出（简单速度继承）
- 与游戏共用 `hand.js` 里的机械手？**不共用**——沙盒用真实摄像头画面，不画假手

### P2 · 发布与投稿（半天，硬截止 11/1 23:59）
1. `npm run build` → 发布为在线链接（需 https，摄像头才可用）
2. **裁剪 `public/mp/`**：只保留 `vision_wasm_internal.*`（SIMD）+ nosimd 兜底，能省 13MB
3. 截图 3–5 张（首页 / 游戏进行中 / 结算 / 手势实验室）+ 30–45 秒录屏
4. 投稿表：作品名、一句话简介、体验链接、截图、社媒链接

## 7. 比赛规则备忘

- 截稿：**2026-11-01 23:59**
- 评分：创意与场景价值 **35** + 作品完成度 **40** + 使用体验 **25** + 社媒分享 **最高 30**
- 主题不限，但作品必须**能公开打开体验**，投稿要交体验链接 + 界面截图或视频

## 8. 设计语言（别破坏）

- 纯白底 + `#0A0A0A` 主色 + `#F4F4F6` 浅灰胶囊；Inter 300/400/500/600
- 圆角一律 `999px`（胶囊）；标题 weight 300、`letter-spacing: -0.03em`
- **彩色只出现在"坏消息"**：`#E5484D` 仅用于危险/超时/碎裂
- HUD 数字必须 `font-variant-numeric: tabular-nums`
- 动效统一 `cubic-bezier(.16,1,.3,1)`

## 9. 开发期调试钩子

```js
window.__game                 // 游戏实例：setAperture / setThumb / setHandNorm / finish / getState / render
window.__classify(landmarks)  // 手势判定（21 个 {x,y} 归一化点），返回 {current, s, pinchGap}
window.__scorecard            // 仅 DEV：{ buildProfile, renderShareCard, canvasToUrl }，不玩也能造数据出图
```

**造一局假数据验证成绩卡**（`tools/shot.mjs --act`）：

```js
const g = window.__game; g.start(); const s = g.getState()
s.score = 1840; s.caught = 23; s.perfects = 9; s.maxCombo = 11; s.misses = 2
s.stat.powerSamples = [2.2, 3.4, 1.8]; s.stat.gapSamples = [0.12, 0.4]
s.stat.nerveSamples = [0.6]; s.stat.fragSeen = 6; s.stat.fragBroken = 1
g.finish()   // 走完整的 onEnd → buildProfile → 结算页
```

## 10. 可以删的临时物

`public/camera-probe.html`（最早的摄像头可行性原型）、`shots/` 下的过程截图、`tools/vidsample.mjs`（一次性测量脚本）。
