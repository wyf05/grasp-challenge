/**
 * 指尖生花 · Bloom
 *
 * 素材：从参考录屏里逆向提取的三种花（牡丹 / 鸢尾 / 山茶），
 * 每组是同一株花从花苞到盛开的序列帧，已按"绽放度"排序（不是时间排序）。
 * 提取工具：tools/flowerframes.mjs
 *
 * 渲染上有三条硬约束，都是被卡顿逼出来的：
 * 1. **不套 ctx.filter**。饱和度/对比度在提取时就烘焙进图片了，
 *    运行时每帧套一次 filter 会直接掉到 10fps 级别。
 * 2. **不做离屏蒙版合成**。之前的实现每帧都要在等大的离屏画布上
 *    做一次 drawImage + 两层渐变 destination-in，再贴回主画布，
 *    相当于每帧两次全幅合成。现在裁片本身是干净的，页面底色又和
 *    素材底色一致（#F5F3ED），直接一次 drawImage 就够。
 * 3. **帧间做交叉淡化**。录屏里能提取到的不同绽放阶段只有 18–22 个，
 *    硬切会看到"台阶"；把相邻两帧按小数部分叠一下，视觉上就是连续的。
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, k) => a + (b - a) * k

/** 页面底色，必须和素材裁片的底色一致，否则会露方块边 */
export const PAGE_BG = '#F5F3ED'

export const FLOWERS = [
  {
    key: 'peony',
    cn: '牡丹',
    en: 'Peony',
    latin: 'Paeonia',
    meaning: '富贵 圆满',
    frames: 20,
    credit: '素材取自参考原型（录屏逆向）',
  },
  {
    key: 'iris',
    cn: '鸢尾',
    en: 'Iris',
    latin: 'Iris germanica',
    meaning: '自由 光明',
    frames: 22,
    credit: '素材取自参考原型（录屏逆向）',
  },
  {
    key: 'camellia',
    cn: '山茶',
    en: 'Camellia',
    latin: 'Camellia japonica',
    meaning: '理想 谨慎',
    frames: 16,
    credit: '素材取自参考原型（录屏逆向）',
  },
]

const frameUrl = (key, i) => `/flora/${key}/${String(i).padStart(2, '0')}.webp`

/**
 * 加载一组序列帧。
 * 不依赖 f.frames 精确匹配文件数：按 0..f.frames-1 并发请求，
 * 取"从 0 开始连续成功"的那一段。重新提取后帧数变了也不会整页挂掉。
 */
export async function loadFlower(f) {
  const one = (i) =>
    new Promise((res, rej) => {
      const img = new Image()
      img.onload = () => res(img)
      img.onerror = () => rej(new Error('missing ' + i))
      img.src = frameUrl(f.key, i)
    })

  const results = await Promise.allSettled(
    Array.from({ length: f.frames || 64 }, (_, i) => one(i)),
  )
  const imgs = []
  for (const r of results) {
    if (r.status !== 'fulfilled') break // 后面的不用管了，缺一张就截断
    imgs.push(r.value)
  }
  if (!imgs.length) throw new Error('no frames for ' + f.key)
  return imgs
}

export function createBloom({ canvas, onHud }) {
  const ctx = canvas.getContext('2d')
  let raf = null
  let last = 0
  let running = false

  const s = {
    t: 0,
    target: 0,
    p: 0,
    hasHand: false,
    index: 0,
    holdT: 0,
    flowers: [],
    fade: 1,
    pending: -1,
  }

  function resize() {
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  const size = () => ({
    w: canvas.width / Math.min(2, window.devicePixelRatio || 1),
    h: canvas.height / Math.min(2, window.devicePixelRatio || 1),
  })

  const cur = () => s.flowers[s.index]

  /** 画一组序列帧在进度 p 上的那一张（相邻帧交叉淡化，避免台阶） */
  function drawAt(img, p, alpha) {
    if (!img || !img.length || alpha <= 0.004) return
    const { w, h } = size()
    const n = img.length
    const idx = clamp(p, 0, 1) * (n - 1)
    const i0 = Math.floor(idx)
    const i1 = Math.min(n - 1, i0 + 1)
    const f = idx - i0

    const a = img[i0]
    if (!a || !a.width) return
    const k = Math.min((w * 0.98) / a.width, (h * 0.92) / a.height)
    const dw = a.width * k
    const dh = a.height * k
    const x = (w - dw) / 2
    const y = (h - dh) / 2

    ctx.globalAlpha = alpha
    ctx.drawImage(a, x, y, dw, dh)
    if (f > 0.01 && img[i1] && img[i1].width === a.width) {
      ctx.globalAlpha = alpha * f
      ctx.drawImage(img[i1], x, y, dw, dh)
    }
    ctx.globalAlpha = 1
  }

  function update(dt) {
    s.t += dt

    // 开得快、收得慢，手感更像"花开"
    const k = s.target > s.p ? 4.2 : 2.6
    s.p = lerp(s.p, s.target, 1 - Math.exp(-k * dt))

    if (s.p > 0.94) s.holdT += dt
    else s.holdT = Math.max(0, s.holdT - dt * 0.8)

    if (s.holdT > 6 && s.pending < 0 && s.flowers.length > 1) {
      s.pending = (s.index + 1) % s.flowers.length
      s.fade = 1
    }
    if (s.pending >= 0) {
      s.fade -= dt * 1.5
      if (s.fade <= 0) {
        s.index = s.pending
        s.pending = -1
        s.holdT = 0
        s.fade = 0
      }
    } else if (s.fade < 1) {
      s.fade = Math.min(1, s.fade + dt * 1.5)
    }

    onHud?.({ bloom: s.p, hasHand: s.hasHand, index: s.index })
  }

  function draw() {
    const { w, h } = size()
    ctx.fillStyle = PAGE_BG
    ctx.fillRect(0, 0, w, h)

    if (s.pending >= 0) {
      drawAt(s.flowers[s.pending], s.p, s.fade)
      drawAt(s.flowers[s.index], s.p, 1 - s.fade)
    } else {
      drawAt(s.flowers[s.index], s.p, 1)
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
      if (g != null) s.target = clamp(0.03 + g * 0.97, 0, 1)
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
