/**
 * 抓取挑战 · 游戏内核
 * 纯逻辑 + Canvas 渲染，不依赖 React。React 只负责挂载、输入和 HUD。
 *
 * 坐标系：逻辑舞台 560 × 720，等比缩放到画布。
 * 约定：g = 1 完全张开，g = 0 完全合拢。
 */

const W = 560
const H = 620

export const OBJ_TYPES = {
  ball: { name: '球', d: 68, base: 10 },
  block: { name: '方块', d: 56, base: 15 },
  egg: { name: '鸡蛋', d: 48, base: 20, fragile: 1.5 },
  glass: { name: '玻璃杯', d: 62, base: 25, fragile: 2.1 },
  pen: { name: '细笔', d: 20, base: 30 },
  bowl: { name: '大碗', d: 94, base: 20 },
}

const HOLD_MS = 120 // 需要保持的时间，越短越靠"提前摆好"而不是"临场找"
const TYPE_KEYS = Object.keys(OBJ_TYPES)

const GAP_MAX = 83 // g=1 时的开口像素，用来把物体尺寸换算成开合度
const HAND = { x: 176, y: 267, scale: 1.2 }
export const GRIP = { x: 258, y: 300 }
const ZONE_HALF = 30
const DEFAULT_DURATION = 90

const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, k) => a + (b - a) * k

/** 物体直径 → 需要的开合度（g=1 开口 GAP_MAX，g=0 闭合） */
const optG = (d) => clamp(d / GAP_MAX, 0.04, 0.98)

/** 容差是"允许几像素误差"折算成开合度：统一 ±4.5px，细笔 ±2.6px */
const tolG = (d) => (d <= 26 ? 0.032 : 0.055)

let bag = []
let lastType = null

/** 洗牌袋：六种物体轮流出现且不连续重复，保证开合幅度必须大幅变化 */
function pickType(progress) {
  if (!bag.length) {
    bag = TYPE_KEYS.filter((k) => {
      const fragile = Boolean(OBJ_TYPES[k].fragile)
      // 开局 15% 进度内不出易碎物，让玩家先熟悉手感
      return !fragile || progress > 0.15
    })
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[bag[i], bag[j]] = [bag[j], bag[i]]
    }
    if (bag[0] === lastType && bag.length > 1) {
      ;[bag[0], bag[1]] = [bag[1], bag[0]]
    }
  }
  const t = bag.pop()
  lastType = t
  return t
}

export function createGame({
  canvas,
  onHud,
  onEnd,
  duration = DEFAULT_DURATION,
  mode = 'slider', // 'slider' | 'camera'
  videoEl = null, // 摄像头模式下作为背景
}) {
  const camMode = mode === 'camera'
  // 摄像头档：读数有噪声，窗口放宽 1.8 倍，保持时间缩短（长时间保持反而更难）
  const tolMul = camMode ? 1.8 : 1
  const holdMs = camMode ? 100 : HOLD_MS
  const ctx = canvas.getContext('2d')

  let raf = null
  let last = 0
  let running = false
  let paused = false

  const s = {
    t: 0,
    duration,
    score: 0,
    combo: 0,
    maxCombo: 0,
    caught: 0,
    perfects: 0,
    misses: 0,
    objects: [],
    effects: [],
    spawnTimer: 1.1,
    g: 1,
    thumb: 0.5,
    gHist: [],
    prevG: 1,
    dgdt: 0,
    shake: 0,
    hand: null, // 掌心在舞台坐标系里的位置（摄像头模式）
    handLm: null, // 21 个关键点（归一化、已镜像）
    handSeenAt: 0,
    gripX: GRIP.x,
    gripY: GRIP.y,
  }

  // ---------- 自适应尺寸 ----------
  function resize() {
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function viewport() {
    const cw = canvas.width / (window.devicePixelRatio || 1)
    const ch = canvas.height / (window.devicePixelRatio || 1)
    const k = Math.min(cw / W, ch / H)
    return { k, ox: (cw - W * k) / 2, oy: (ch - H * k) / 2, cw, ch }
  }

  // ---------- 手位 ----------
  const dpr = () => window.devicePixelRatio || 1

  /** 归一化坐标 → 舞台坐标（含镜像与 cover 裁切换算） */
  function normToStage(nx, ny) {
    const vw = videoEl.videoWidth || 640
    const vh = videoEl.videoHeight || 480
    const cw = canvas.width / dpr()
    const ch = canvas.height / dpr()
    const sc = Math.max(cw / vw, ch / vh)
    const dh = vh * sc
    const dx0 = (cw - vw * sc) / 2
    const dy0 = (ch - dh) / 2
    // 画面做了水平镜像，屏幕 x = cw - 未镜像时的 x
    const screenX = cw - (dx0 + nx * vw * sc)
    const screenY = dy0 + ny * vh * sc
    const vp = viewport()
    return { x: (screenX - vp.ox) / vp.k, y: (screenY - vp.oy) / vp.k }
  }

  /** 设置手位（含骨架） */
  function setHandNorm(nx, ny, skeleton) {
    if (!videoEl) return
    if (skeleton) {
      s.handLm = skeleton
      s.handSeenAt = performance.now()
    }
    const { x: sx, y: sy } = normToStage(nx, ny)
    // 轻微平滑，避免手抖带动整个通道跳动
    s.hand = s.hand
      ? { x: s.hand.x + (sx - s.hand.x) * 0.35, y: s.hand.y + (sy - s.hand.y) * 0.35 }
      : { x: sx, y: sy }
    // 夹到合理游玩区：手太靠上就没有反应时间，太靠边物体就会生在屏幕外
    s.gripX = clamp(s.hand.x, 90, W - 90)
    s.gripY = clamp(s.hand.y, H * 0.34, H * 0.86)
  }

  // ---------- 输入 ----------
  function setAperture(v) {
    s.g = clamp(v, 0, 1)
  }
  function setThumb(v) {
    s.thumb = clamp(v, 0, 1)
  }
  /** 滑轨模式下拇指是细调（±5%）；摄像头模式下拇指已经包含在真实手势里，不再叠加 */
  const effG = () => (camMode ? clamp(s.g, 0, 1) : clamp(s.g + (s.thumb - 0.5) * 0.1, 0, 1))

  // ---------- 生成 ----------
  function spawn() {
    const p = Math.min(1, s.t / s.duration)
    let type = pickType(p)
    if (camMode && type === 'pen') type = 'glass'
    const def = OBJ_TYPES[type]
    const scale = lerp(1, 0.82, p) // 越到后面物体越小
    const d = def.d * scale
    const vy = lerp(190, 400, p) * lerp(1, 1.06, Math.random())
    s.objects.push({
      type,
      def,
      d,
      gOpt: optG(d),
      tol: tolG(d) * tolMul,
      x: s.gripX + (Math.random() - 0.5) * 18,
      y: -d,
      vy,
      state: 'falling',
      lock: 0,
      rot: (Math.random() - 0.5) * 0.25,
      touched: false,
    })
  }

  // ---------- 更新 ----------
  function update(dt) {
    s.t += dt
    if (s.t >= s.duration) {
      finish()
      return
    }

    // 闭合速度用瞬时值，判定用手势的 3 帧均值（摄像头噪声大，单帧不可信）
    const eg = effG()
    s.dgdt = dt > 0 ? (eg - s.prevG) / dt : 0
    s.prevG = eg
    s.gHist.push(eg)
    if (s.gHist.length > 3) s.gHist.shift()
    const gJudge = camMode ? s.gHist.reduce((a, b) => a + b, 0) / s.gHist.length : eg

    // 生成
    const p = Math.min(1, s.t / s.duration)
    s.spawnTimer -= dt
    if (s.spawnTimer <= 0) {
      spawn()
      s.spawnTimer = lerp(1.7, 0.62, p)
    }

    for (const o of s.objects) {
      if (o.state !== 'falling') continue
      o.y += o.vy * dt

      const inZone = Math.abs(o.y - s.gripY) <= ZONE_HALF + o.d * 0.25
      // 摄像头模式下，手还得横向对上，才谈得上"抓住"
      const aligned = !camMode || Math.abs(o.x - s.gripX) <= 70 + o.d * 0.4

      if (inZone && aligned) {
        if (!o.touched) {
          o.touched = true
          // 易碎物：闭合太猛，第一次接触就碎
          if (o.def.fragile && Math.abs(s.dgdt) > o.def.fragile) {
            breakObject(o)
            continue
          }
        }

        const diff = Math.abs(gJudge - o.gOpt)
        if (diff <= o.tol) {
          o.lock += dt * 1000
          if (o.lock >= holdMs) {
            catchObject(o, diff)
            continue
          }
        } else {
          o.lock = Math.max(0, o.lock - dt * 2000)
        }
      }

      if (o.y > H + o.d) {
        o.state = 'missed'
        s.misses += 1
        s.combo = 0
        s.shake = 14
        s.effects.push({ kind: 'miss', x: o.x, y: H - 30, t: 0 })
        if (s.misses >= 3) {
          finish()
          return
        }
      }
    }

    // 效果衰减
    for (const e of s.effects) e.t += dt
    s.effects = s.effects.filter((e) => e.t < 1)
    s.shake *= Math.pow(0.001, dt)

    // 已解决的物体再留一小会儿用于表现，然后移出舞台
    for (const o of s.objects) {
      if (o.state !== 'falling') o.gone = (o.gone || 0) + dt
    }
    s.objects = s.objects.filter((o) => o.state === 'falling' || o.gone < 0.32)

    pushHud()
  }

  function catchObject(o, diff) {
    o.state = 'held'
    o.holdT = 0
    o.y = GRIP.y // 吸附到钳口，视觉上真的被夹住
    s.caught += 1
    s.combo += 1
    s.maxCombo = Math.max(s.maxCombo, s.combo)

    const precision = 1 + (1 - diff / o.tol) * 0.5
    const comboMul = Math.min(3, 1 + Math.min(s.combo, 20) * 0.1)
    const perfect = diff <= o.tol * 0.25
    let gain = o.def.base * precision * comboMul
    if (perfect) {
      gain += 5
      s.perfects += 1
    }
    s.score = Math.round(s.score + gain)

    s.effects.push({
      kind: perfect ? 'perfect' : 'catch',
      x: o.x,
      y: GRIP.y,
      t: 0,
      text: '+' + Math.round(gain),
      combo: s.combo,
    })
  }

  function breakObject(o) {
    o.state = 'broken'
    s.combo = 0
    s.misses += 1
    s.shake = 20
    s.effects.push({ kind: 'break', x: o.x, y: o.y, t: 0, d: o.d })
    if (s.misses >= 3) finish()
  }

  // ---------- 渲染 ----------
  /** 真实手部骨架：白线 + 暗投影，保证在任意背景上都看得清 */
  function drawSkeleton() {
    const lm = s.handLm
    if (!camMode || !lm) return
    if (performance.now() - s.handSeenAt > 400) return // 手丢了就别留残影

    const pts = lm.map((p) => normToStage(p.x, p.y))

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // 先用深色描一遍做投影
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'
    ctx.lineWidth = 4.2
    ctx.beginPath()
    for (const [a, b] of HAND_BONES) {
      ctx.moveTo(pts[a].x, pts[a].y)
      ctx.lineTo(pts[b].x, pts[b].y)
    }
    ctx.stroke()

    ctx.strokeStyle = 'rgba(255,255,255,0.88)'
    ctx.lineWidth = 2.1
    ctx.beginPath()
    for (const [a, b] of HAND_BONES) {
      ctx.moveTo(pts[a].x, pts[a].y)
      ctx.lineTo(pts[b].x, pts[b].y)
    }
    ctx.stroke()

    // 关节
    for (let i = 0; i < pts.length; i++) {
      const tip = [4, 8, 12, 16, 20].includes(i)
      ctx.beginPath()
      ctx.arc(pts[i].x, pts[i].y, tip ? 5 : 3.2, 0, Math.PI * 2)
      ctx.fillStyle = tip ? '#FFFFFF' : 'rgba(255,255,255,0.85)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
    ctx.restore()
  }

  function drawObject(o) {
    if (o.state === 'broken') return
    const { d } = o
    const x = o.x
    const y = o.y
    const half = d / 2

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(o.rot)

    // 统一路径，供填充与描边复用
    const path = () => {
      ctx.beginPath()
      switch (o.type) {
        case 'ball':
          ctx.arc(0, 0, half, 0, Math.PI * 2)
          break
        case 'block': {
          const r = Math.min(10, d * 0.16)
          ctx.roundRect
            ? ctx.roundRect(-half, -half, d, d, r)
            : ctx.rect(-half, -half, d, d)
          break
        }
        case 'egg':
          ctx.ellipse(0, 0, d * 0.42, half, 0, 0, Math.PI * 2)
          break
        case 'glass': {
          const top = d * 0.46
          const bot = d * 0.34
          const h = half
          ctx.moveTo(-top, -h)
          ctx.lineTo(top, -h)
          ctx.lineTo(bot, h)
          ctx.lineTo(-bot, h)
          ctx.closePath()
          break
        }
        case 'pen': {
          const h = d * 1.25
          ctx.roundRect
            ? ctx.roundRect(-half, -h, d, h * 2, half)
            : ctx.rect(-half, -h, d, h * 2)
          break
        }
        case 'bowl': {
          const r = half
          ctx.arc(0, -r * 0.18, r, 0, Math.PI)
          ctx.closePath()
          break
        }
      }
    }

    // ---- 主体：白底 + 顶部高光 + 底部灰影 ----
    const grad = ctx.createLinearGradient(0, -half, 0, half)
    if (o.type === 'glass') {
      grad.addColorStop(0, 'rgba(255,255,255,0.92)')
      grad.addColorStop(0.55, 'rgba(246,247,249,0.82)')
      grad.addColorStop(1, 'rgba(226,228,233,0.86)')
    } else {
      grad.addColorStop(0, '#FFFFFF')
      grad.addColorStop(0.55, '#F7F7F9')
      grad.addColorStop(1, '#E4E5EA')
    }

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.20)'
    ctx.shadowBlur = 12
    ctx.shadowOffsetY = 5
    path()
    ctx.fillStyle = grad
    ctx.fill()
    ctx.restore()

    // ---- 描边 ----
    ctx.strokeStyle = '#0A0A0A'
    ctx.lineWidth = Math.max(2, d * 0.035)
    ctx.lineJoin = 'round'
    path()
    ctx.stroke()

    // ---- 细节：每种物体一套"贴图" ----
    ctx.save()
    path()
    ctx.clip()

    switch (o.type) {
      case 'ball': {
        // 左上方高光 + 底部反光
        const hl = ctx.createRadialGradient(-half * 0.35, -half * 0.4, 1, -half * 0.35, -half * 0.4, half * 0.95)
        hl.addColorStop(0, 'rgba(255,255,255,0.98)')
        hl.addColorStop(0.45, 'rgba(255,255,255,0.35)')
        hl.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = hl
        ctx.fillRect(-half, -half, d, d)
        ctx.strokeStyle = 'rgba(10,10,10,0.10)'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.arc(0, 0, half * 0.72, 0.15 * Math.PI, 0.85 * Math.PI)
        ctx.stroke()
        break
      }
      case 'block': {
        // 倒角棱线 + 右上角折角
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = Math.max(1.4, d * 0.03)
        const inset = d * 0.12
        ctx.beginPath()
        ctx.moveTo(-half + inset, -half + inset)
        ctx.lineTo(half - inset, -half + inset)
        ctx.lineTo(half - inset, half - inset)
        ctx.stroke()
        ctx.strokeStyle = 'rgba(10,10,10,0.08)'
        ctx.beginPath()
        ctx.moveTo(half - inset, -half + inset)
        ctx.lineTo(half - inset, half - inset)
        ctx.lineTo(-half + inset, half - inset)
        ctx.stroke()
        break
      }
      case 'egg': {
        const hl = ctx.createRadialGradient(-d * 0.16, -half * 0.5, 1, -d * 0.16, -half * 0.5, half * 0.9)
        hl.addColorStop(0, 'rgba(255,255,255,1)')
        hl.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = hl
        ctx.fillRect(-half, -half, d, d)
        // 蛋壳斑点
        ctx.fillStyle = 'rgba(10,10,10,0.10)'
        ;[[0.18, 0.1], [-0.2, 0.28], [0.05, -0.3]].forEach(([a, b]) => {
          ctx.beginPath()
          ctx.arc(d * a, d * b, d * 0.035, 0, Math.PI * 2)
          ctx.fill()
        })
        break
      }
      case 'glass': {
        // 杯口 + 竖向高光 + 液面
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'
        ctx.lineWidth = Math.max(1.4, d * 0.028)
        ctx.beginPath()
        ctx.ellipse(0, -half * 0.94, d * 0.44, d * 0.075, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'
        ctx.lineWidth = Math.max(2, d * 0.05)
        ctx.beginPath()
        ctx.moveTo(-d * 0.3, -half * 0.6)
        ctx.lineTo(-d * 0.24, half * 0.6)
        ctx.stroke()
        ctx.fillStyle = 'rgba(10,10,10,0.06)'
        ctx.fillRect(-d, half * 0.25, d * 2, half)
        break
      }
      case 'pen': {
        // 笔帽 + 笔尖
        ctx.fillStyle = 'rgba(10,10,10,0.09)'
        ctx.fillRect(-d, -d * 0.72, d * 2, d * 0.5)
        ctx.strokeStyle = 'rgba(10,10,10,0.35)'
        ctx.lineWidth = Math.max(1.2, d * 0.03)
        ctx.beginPath()
        ctx.moveTo(-half, -d * 0.22)
        ctx.lineTo(half, -d * 0.22)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(-half, d * 0.95)
        ctx.lineTo(half, d * 0.95)
        ctx.stroke()
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = Math.max(1.2, d * 0.03)
        ctx.beginPath()
        ctx.moveTo(-half * 0.5, -d * 1.05)
        ctx.lineTo(-half * 0.5, d * 0.85)
        ctx.stroke()
        break
      }
      case 'bowl': {
        // 碗口 + 内壁阴影
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'
        ctx.lineWidth = Math.max(1.6, d * 0.03)
        ctx.beginPath()
        ctx.ellipse(0, -half * 0.18, half * 0.96, half * 0.16, 0, 0, Math.PI * 2)
        ctx.stroke()
        const inner = ctx.createLinearGradient(0, -half * 0.18, 0, half * 0.86)
        inner.addColorStop(0, 'rgba(10,10,10,0.16)')
        inner.addColorStop(0.5, 'rgba(10,10,10,0.03)')
        inner.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = inner
        ctx.fillRect(-d, -half * 0.18, d * 2, d)
        break
      }
    }
    ctx.restore()

    // 前景描边加一层，压住细节
    ctx.strokeStyle = 'rgba(10,10,10,0.9)'
    ctx.lineWidth = Math.max(1.6, d * 0.028)
    path()
    ctx.stroke()

    ctx.restore()

    // 需要的开口提示：一圈虚线
    if (o.state === 'falling' && o.y > -20) {
      ctx.save()
      ctx.setLineDash([3, 6])
      ctx.strokeStyle = camMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.18)'
      ctx.lineWidth = 1.2
      if (camMode) {
        ctx.shadowColor = 'rgba(0,0,0,0.55)'
        ctx.shadowBlur = 4
      }
      ctx.beginPath()
      ctx.arc(x, y, o.d / 2 + 12, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    // 锁定进度环
    if (o.lock > 0 && o.state === 'falling') {
      const p = Math.min(1, o.lock / holdMs)
      ctx.save()
      ctx.strokeStyle = camMode ? '#FFFFFF' : '#0A0A0A'
      ctx.lineWidth = 3.5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(x, y, o.d / 2 + 7, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  function draw() {
    const { k, ox, oy, cw, ch } = viewport()
    ctx.clearRect(0, 0, cw, ch)

    // 通道线与地面画在整块画布坐标系里，抹掉等比留白的边界感
    ctx.save()
    ctx.strokeStyle = 'rgba(0,0,0,0.05)'
    ctx.lineWidth = 1
    ctx.setLineDash([6, 10])
    ctx.beginPath()
    ctx.moveTo(ox + (camMode ? s.gripX : GRIP.x) * k, 0)
    ctx.lineTo(ox + (camMode ? s.gripX : GRIP.x) * k, ch)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.strokeStyle = 'rgba(0,0,0,0.10)'
    ctx.beginPath()
    ctx.moveTo(0, oy + (H - 26) * k)
    ctx.lineTo(cw, oy + (H - 26) * k)
    ctx.stroke()
    ctx.restore()

    // 摄像头模式：真实画面当背景（水平镜像，和照镜子的直觉一致）
    if (camMode && videoEl && videoEl.videoWidth) {
      const vw = videoEl.videoWidth
      const vh = videoEl.videoHeight
      const sc = Math.max(cw / vw, ch / vh)
      const dw = vw * sc
      const dh = vh * sc
      ctx.save()
      ctx.translate(cw, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(videoEl, (cw - dw) / 2, (ch - dh) / 2, dw, dh)
      ctx.restore()
      // 压一层极淡的白，保证黑色物体和文字可读
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      ctx.fillRect(0, 0, cw, ch)
    }

    ctx.save()
    ctx.translate(ox + (Math.random() - 0.5) * s.shake, oy + (Math.random() - 0.5) * s.shake)
    ctx.scale(k, k)

    // 抓取区
    ctx.strokeStyle = 'rgba(0,0,0,0.10)'
    ctx.setLineDash([2, 6])
    ;[GRIP.y - ZONE_HALF, GRIP.y + ZONE_HALF].forEach((yy) => {
      ctx.beginPath()
      ctx.moveTo(GRIP.x - 70, yy)
      ctx.lineTo(GRIP.x + 70, yy)
      ctx.stroke()
    })
    ctx.setLineDash([])

    const handAlive = s.handLm && performance.now() - s.handSeenAt < 400
    const nearObj = s.objects.some(
      (o) => o.state === 'falling' && Math.hypot(o.x - s.gripX, o.y - s.gripY) < 110
    )
    if (camMode && !nearObj && !handAlive) {
      // 抓取准星：只在附近没有物体时显示，避免和物体提示环打架
      const gx = s.gripX
      const gy = s.gripY
      ctx.save()
      ctx.setLineDash([4, 6])
      ctx.strokeStyle = 'rgba(10,10,10,0.35)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(gx, gy, 34 + (1 - effG()) * 26, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(gx, gy, 34 + (1 - effG()) * 26, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    } else if (!camMode) {
      drawHandLocal(ctx, HAND.x, HAND.y, effG(), s.thumb)
    }

    drawSkeleton()

    // 物体
    for (const o of s.objects) drawObject(o)

    // 效果
    for (const e of s.effects) drawEffect(e)

    ctx.restore()
  }

  // hand.js 在下方注入，避免循环依赖
  let drawHandLocal = () => {}

  function drawEffect(e) {
    const p = e.t
    if (e.kind === 'catch' || e.kind === 'perfect') {
      const r = e.d || 30
      const rad = r + p * 70
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - p)
      ctx.strokeStyle = '#0A0A0A'
      ctx.lineWidth = e.kind === 'perfect' ? 2.5 : 1.5
      ctx.beginPath()
      ctx.arc(e.x, GRIP.y - p * 26, rad, 0, Math.PI * 2)
      ctx.stroke()
      if (e.kind === 'perfect') {
        ctx.globalAlpha = Math.max(0, 1 - p) * 0.5
        ctx.beginPath()
        ctx.arc(e.x, GRIP.y - p * 26, rad * 0.65, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalAlpha = Math.max(0, 1 - p * 1.4)
      ctx.fillStyle = '#0A0A0A'
      ctx.font = '500 20px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(e.text, e.x, GRIP.y - 46 - p * 34)
      ctx.restore()
    }
    if (e.kind === 'break') {
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - p * 1.2)
      ctx.fillStyle = '#E5484D'
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2
        const dist = 10 + p * 90
        ctx.beginPath()
        ctx.arc(e.x + Math.cos(a) * dist, e.y + Math.sin(a) * dist, 3.5 * (1 - p), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
    if (e.kind === 'miss') {
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - p * 1.6)
      ctx.fillStyle = '#E5484D'
      ctx.font = '500 13px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('MISS', e.x, e.y - p * 20)
      ctx.restore()
    }
  }

  function pushHud() {
    const now = performance.now()
    if (!pushHud.last || now - pushHud.last > 80) {
      pushHud.last = now
      const target = activeTarget()
      onHud?.({
        score: s.score,
        combo: s.combo,
        time: Math.max(0, s.duration - s.t),
        misses: s.misses,
        caught: s.caught,
        g: effG(),
        thumb: s.thumb,
        target: target
          ? { name: target.def.name, gOpt: target.gOpt, tol: target.tol, color: '#0A0A0A' }
          : null,
      })
    }
  }

  /** 当前该看的物体：离抓取区最近、还在下落的那个 */
  function activeTarget() {
    let best = null
    let bestD = Infinity
    for (const o of s.objects) {
      if (o.state !== 'falling') continue
      const d = Math.abs(o.y - GRIP.y)
      if (o.y < GRIP.y - 200) continue
      if (d < bestD) {
        bestD = d
        best = o
      }
    }
    return best
  }

  function loop(ts) {
    if (!running) return
    const raw = (ts - last) / 1000
    const dt = Number.isFinite(raw) && raw > 0 && raw < 0.5 ? raw : 1 / 60
    last = ts
    if (!paused) update(dt)
    draw()
    raf = requestAnimationFrame(loop)
  }

  function finish() {
    if (!running) return
    running = false
    if (raf) cancelAnimationFrame(raf)
    onEnd?.({
      score: s.score,
      caught: s.caught,
      perfects: s.perfects,
      maxCombo: s.maxCombo,
      misses: s.misses,
      time: Math.min(s.duration, s.t),
      rate: s.caught / Math.max(1, s.caught + s.misses),
    })
  }

  return {
    setHandRenderer(fn) {
      drawHandLocal = fn
    },
    start() {
      resize()
      running = true
      last = performance.now()
      raf = requestAnimationFrame(loop)
    },
    stop() {
      running = false
      if (raf) cancelAnimationFrame(raf)
    },
    pause(v) {
      paused = v
    },
    setAperture,
    setThumb,
    setHandNorm,
    resize,
    render() {
      resize()
      draw()
    },
    getState: () => s,
    finish,
    GRIP,
    W,
    H,
  }
}
