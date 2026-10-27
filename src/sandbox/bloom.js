/**
 * 指尖生花 · Bloom
 *
 * 花朵素材来自 Wikimedia Commons 的开花延时视频（CC BY 3.0），
 * 已用 tools/keyframes.mjs 抠成透明底序列帧，放在 public/bloom/<key>/NN.webp。
 *
 * 手的开合度直接映射到"第几帧"，等于把手当成时间轴拖拽器：
 * 张开 → 往后拖 → 花开；握拳 → 往前拖 → 收回花苞。
 *
 * 素材中段有抠不干净的背景（干草、叶片），这里用一层柔边遮罩把它压进
 * 白色渐隐里——既藏了瑕疵，也让花像是"从光里长出来"。
 */

const TAU = Math.PI * 2
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, k) => a + (b - a) * k

export const FLOWERS = [
  {
    key: 'f2',
    name: 'Peony',
    cn: '芍药',
    credit: 'Zuzka Slaninková / Wikimedia Commons / CC BY 3.0',
    // 源视频最后一帧是淡出黑场，抠完是空图，所以只取前 21 帧
    frames: 21,
  },
  {
    key: 'f1',
    name: 'Poppy',
    cn: '虞美人',
    credit: 'Ajith Samuel / Wikimedia Commons / CC BY 3.0',
    frames: 22,
  },
]

const frameUrl = (key, i) => `/bloom/${key}/${String(i).padStart(2, '0')}.webp`

export async function loadFlower(f) {
  const imgs = await Promise.all(
    Array.from(
      { length: f.frames },
      (_, i) =>
        new Promise((res, rej) => {
          const img = new Image()
          img.onload = () => res(img)
          img.onerror = rej
          img.src = frameUrl(f.key, i)
        }),
    ),
  )
  return imgs
}

export function createBloom({ canvas, onHud }) {
  const ctx = canvas.getContext('2d')
  let raf = null
  let last = 0
  let running = false
  let mask = null

  const s = {
    t: 0,
    /** 目标开合度 0..1（来自手） */
    target: 0,
    /** 平滑后的实际绽放度 */
    p: 0,
    hasHand: false,
    index: 0,
    /** 完全绽放后停留的时长，用来决定换花 */
    holdT: 0,
    flowers: [],
    /** 换花时的交叉淡入 */
    fade: 1,
    pending: -1,
    petals: [],
  }

  function resize() {
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    mask = document.createElement('canvas')
    mask.width = canvas.width
    mask.height = canvas.height
  }

  const size = () => ({
    w: canvas.width / Math.min(2, window.devicePixelRatio || 1),
    h: canvas.height / Math.min(2, window.devicePixelRatio || 1),
  })

  const cur = () => s.flowers[s.index]
  const frameOf = (img, p) => img[clamp(Math.round(p * (img.length - 1)), 0, img.length - 1)]

  function drawFlower(img, p, alpha) {
    if (!img || !img.length || alpha <= 0.002) return
    const { w, h } = size()
    const pic = frameOf(img, p)
    // 等比塞进画布（同时受宽和高约束），否则竖屏下宽度会溢出被裁
    // 0.78：留出四周白，否则花会顶满整个屏幕、贴着边缘切断
    const k = Math.min((w * 0.98) / pic.width, (h * 0.98) / pic.height) * 0.70
    const dw = pic.width * k
    const dh = pic.height * k
    const x = (w - dw) / 2
    const y = (h - dh) / 2

    const mctx = mask.getContext('2d')
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    mctx.setTransform(1, 0, 0, 1, 0, 0)
    mctx.clearRect(0, 0, mask.width, mask.height)
    mctx.drawImage(pic, x * dpr, y * dpr, dw * dpr, dh * dpr)

    // 柔边遮罩：中心全保留，外圈渐隐到全透明
    // 遮罩半径跟着"画出来的图"走，保证图片自身的矩形边界一定被吃掉；
    // 固定在画布中心按短边算的话，图比画布小时边缘会留一道硬边
    const cx = mask.width / 2
    const cy = mask.height / 2
    const R = Math.max(dw, dh) * dpr * 0.5
    mctx.globalCompositeOperation = 'destination-in'

    // 1) 四周轻微收边，吃掉图片自身的矩形边界
    const rad = mctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.08)
    rad.addColorStop(0, 'rgba(0,0,0,1)')
    rad.addColorStop(1, 'rgba(0,0,0,0)')
    mctx.fillStyle = rad
    mctx.fillRect(0, 0, mask.width, mask.height)

    // 2) 上下再压一道线性渐隐：残留杂物都贴在画面的顶部和底部，
    //    花本身在中间，这样只裁掉上下 10% 就能把它们藏掉，花瓣不受影响
    const top = mask.height * 0.5 - (dh * dpr) / 2
    const bot = mask.height * 0.5 + (dh * dpr) / 2
    const lin = mctx.createLinearGradient(0, top, 0, bot)
    lin.addColorStop(0, 'rgba(0,0,0,0)')
    lin.addColorStop(0.14, 'rgba(0,0,0,1)')
    lin.addColorStop(0.94, 'rgba(0,0,0,1)')
    lin.addColorStop(1, 'rgba(0,0,0,0)')
    mctx.fillStyle = lin
    mctx.fillRect(0, 0, mask.width, mask.height)

    mctx.globalCompositeOperation = 'source-over'

    ctx.globalAlpha = alpha
    ctx.drawImage(mask, 0, 0, w, h)
    ctx.globalAlpha = 1
  }

  function update(dt) {
    s.t += dt

    // 手抖会让 p 跳，用指数平滑压住；开得快、收得慢，手感更像"开花"
    const k = s.target > s.p ? 3.4 : 2.2
    s.p = lerp(s.p, s.target, 1 - Math.exp(-k * dt))

    if (s.p > 0.93) s.holdT += dt
    else s.holdT = Math.max(0, s.holdT - dt * 0.6)

    // 开满停 5 秒就换下一朵
    if (s.holdT > 5 && s.pending < 0 && s.flowers.length > 1) {
      s.pending = (s.index + 1) % s.flowers.length
      s.fade = 1
    }
    if (s.pending >= 0) {
      s.fade -= dt * 1.6
      if (s.fade <= 0) {
        s.index = s.pending
        s.pending = -1
        s.holdT = 0
        s.fade = 0
      }
    } else if (s.fade < 1) {
      s.fade = Math.min(1, s.fade + dt * 1.6)
    }

    onHud?.({
      bloom: s.p,
      hasHand: s.hasHand,
      flower: cur(),
      index: s.index,
    })
  }

  function draw() {
    const { w, h } = size()
    ctx.clearRect(0, 0, w, h)

    // 极浅的暖白底色，让花的边缘有"落地感"
    const bg = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.5, Math.max(w, h) * 0.75)
    bg.addColorStop(0, '#ffffff')
    bg.addColorStop(1, '#f7f4f1')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    if (s.pending >= 0) {
      drawFlower(s.flowers[s.pending], s.p, s.fade)
      drawFlower(s.flowers[s.index], s.p, 1 - s.fade)
    } else {
      drawFlower(s.flowers[s.index], s.p, 1 - s.fade * 0.6)
    }
  }

  function loop(ts) {
    if (!running) return
    const raw = (ts - last) / 1000
    const dt = Number.isFinite(raw) && raw > 0 && raw < 0.4 ? raw : 1 / 60
    last = ts
    update(dt)
    draw()
    raf = requestAnimationFrame(loop)
  }

  return {
    setFlowers(list) {
      s.flowers = list
      s.index = 0
    },
    start() {
      resize()
      if (raf) cancelAnimationFrame(raf)
      running = true
      last = performance.now()
      raf = requestAnimationFrame(loop)
    },
    stop() {
      running = false
      if (raf) cancelAnimationFrame(raf)
    },
    resize,
    render() {
      resize()
      draw()
    },
    /** g: 0..1 开合度；null 表示没检测到手 */
    setOpenness(g) {
      s.hasHand = g != null
      // 留一点底：手完全握拳也保留花苞，不要变成空白
      s.target = g == null ? s.target : clamp(0.04 + g * 0.96, 0, 1)
    },
    next() {
      if (s.flowers.length < 2) return
      s.pending = (s.index + 1) % s.flowers.length
      s.fade = 1
      s.holdT = 0
    },
    getState: () => s,
  }
}
