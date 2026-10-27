/**
 * 捏气球 · STRESS PURGE
 * 纯 Canvas 内核，不依赖 React（和 game/engine.js 同一套分工）。
 *
 * 参考原型的关键设定：
 *   - 深紫星空底，气球在三维空间里漂（用透视除法做 2.5D，不引 Three.js）
 *   - 手部骨架以白色细线叠在画面上，指尖带小光芒
 *   - 捏合（开合度变小）且指尖落在气球内 → 爆；空处捏合拖拽 → 平移视角
 *   - 松手时把手的速度甩给附近的球（对应原型的 "pinch and release to throw"）
 */

import { createSfx } from '../sfx.js'

const TAU = Math.PI * 2
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, k) => a + (b - a) * k
const rand = (a, b) => a + Math.random() * (b - a)

const HUES = [258, 285, 205, 330, 12, 172, 46]
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]
const TIPS = [4, 8, 12, 16, 20]

export function createPurge({ canvas, onHud, onEnd, duration = 60 }) {
  const ctx = canvas.getContext('2d')
  const sfx = createSfx()
  let raf = null
  let last = 0
  let running = false

  const s = {
    t: 0,
    duration,
    score: 0,
    combo: 0,
    maxCombo: 0,
    popped: 0,
    balloons: [],
    particles: [],
    shards: [],
    flashes: [],
    ripples: [],
    hands: [],
    pan: { x: 0, y: 0, vx: 0, vy: 0 },
    pinching: false,
    grabAt: null,
    stars: [],
    shake: 0,
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

  function makeStars() {
    s.stars = Array.from({ length: 90 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: rand(0.6, 1.9),
      a: rand(0.15, 0.75),
      tw: rand(0.6, 2.2),
    }))
  }

  function spawn(initial = false) {
    const z = rand(0.55, 1.9)
    s.balloons.push({
      x: rand(-0.9, 0.9),
      y: rand(-0.9, 0.9),
      z,
      vx: rand(-0.3, 0.3),
      vy: rand(-0.42, -0.16),
      r: 38,
      hue: HUES[(Math.random() * HUES.length) | 0],
      seed: Math.random() * TAU,
      born: s.t,
    })
  }

  function fill() {
    const target = 8
    while (s.balloons.length < target) spawn(s.t < 1)
  }

  function project(b) {
    const { w, h } = size()
    const k = 0.46
    return {
      x: w / 2 + ((b.x + s.pan.x) * w * k) / b.z,
      y: h / 2 + ((b.y + s.pan.y) * h * k * 0.9) / b.z,
      r: b.r / b.z,
    }
  }

  /** 指尖 → 屏幕坐标（手部坐标是摄像头归一化值，已镜像） */
  function toScreen(nx, ny) {
    const { w, h } = size()
    // 摄像头 4:3、画布更瘦：按 cover 裁两侧
    const camAR = 4 / 3
    const boxAR = w / h
    let u = nx
    let v = ny
    if (boxAR < camAR) {
      const visible = boxAR / camAR
      u = (nx - 0.5) * visible + 0.5
    }
    v = (ny - 0.5) * 1.06 + 0.5
    return { x: u * w, y: v * h }
  }

  function pop(b, fromX, fromY) {
    const p = project(b)
    s.popped += 1
    s.combo += 1
    s.lastPop = s.t
    s.maxCombo = Math.max(s.maxCombo, s.combo)
    const mul = 1 + Math.min(s.combo, 8) * 0.12
    const gain = Math.round((40 + Math.max(0, 1.9 - b.z) * 48) * mul)
    s.score += gain
    s.shake = 6 + Math.max(0, 1.9 - b.z) * 7

    const depth = clamp((1.9 - b.z) / 1.35, 0, 1)
    sfx.pop(depth, s.combo)

    // 撕碎的橡胶碎片：不规则多边形 + 自转 + 重力（参考里爆开是一把碎片，不是均匀粒子）
    const NS = 14
    for (let i = 0; i < NS; i++) {
      const a = (i / NS) * TAU + rand(-0.35, 0.35)
      const sp = rand(60, 230) * (0.6 + depth * 0.8)
      const k = 3 + ((Math.random() * 3) | 0)
      const pts = []
      for (let j = 0; j < k; j++) {
        const ang = (j / k) * TAU + rand(-0.2, 0.2)
        const rr = rand(0.45, 1)
        pts.push([Math.cos(ang) * rr, Math.sin(ang) * rr])
      }
      s.shards.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 70,
        rot: rand(0, TAU),
        vr: rand(-9, 9),
        size: rand(8, 19) * (0.7 + depth * 0.6),
        hue: b.hue + rand(-10, 10),
        life: 0,
        ttl: rand(0.42, 0.7),
        pts,
      })
    }

    const n = 14
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.2, 0.2)
      const sp = rand(120, 420) * (0.7 + Math.max(0, 1.9 - b.z) * 0.45)
      s.particles.push({
        x: p.x + Math.cos(a) * p.r * 0.5,
        y: p.y + Math.sin(a) * p.r * 0.5,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 0,
        ttl: rand(0.45, 0.95),
        r: rand(1.6, 4.2),
        hue: b.hue,
      })
    }
    s.flashes.push({ x: p.x, y: p.y, r: p.r, life: 0, ttl: 0.16, hue: b.hue })
    s.balloons = s.balloons.filter((x) => x !== b)
  }

  function update(dt) {
    s.t += dt
    if (s.t >= s.duration) {
      finish()
      return
    }
    fill()

    // 手：取第一只手的位置和开合度
    const hand = s.hands[0]
    const tip = hand && hand.detected ? toScreen(hand.tipX, hand.tipY) : null
    const pinch = Boolean(hand && hand.detected && hand.g < 0.32)

    if (tip) {
      if (pinch && !s.pinching) {
        s.grabAt = { ...tip, t: s.t }
        // 捏合的第一帧就做一次更宽松的判定（1.55r）：
        // 用户说的是"一次捏不爆"，而捏合的过程只有 2–3 帧，窗口太窄就会漏
        let first = null
        for (const b of s.balloons) {
          const q = project(b)
          if (Math.hypot(tip.x - q.x, tip.y - q.y) < q.r * 1.55) {
            if (!first || b.z < first.z) first = b
          }
        }
        if (first) {
          pop(first, tip.x, tip.y)
        } else {
          const near = s.balloons.some((b) => {
            const q = project(b)
            return Math.hypot(tip.x - q.x, tip.y - q.y) < q.r * 2.2
          })
          if (near) sfx.squish()
        }
      }

      if (pinch) {
        // 捏合中：指尖在球内就爆，否则拖拽平移视角
        let hit = null
        for (const b of s.balloons) {
          const p = project(b)
          // 1.25r：碰到球面甚至差一点点都算捏到，不用戳进球心
          if (Math.hypot(tip.x - p.x, tip.y - p.y) < p.r * 1.25) {
            if (!hit || b.z < hit.b.z) hit = b
          }
        }
        if (hit) {
          pop(hit, tip.x, tip.y)
        }
        // 不再支持"捏住拖动平移视角"：页面跟着手走会让体验变差
        s.pan.vx = 0
        s.pan.vy = 0
      } else if (s.pinching) {
        // 刚松手：把手的速度甩给附近的球
        const sp = Math.hypot(s.pan.vx, s.pan.vy)
        if (sp > 260) {
          const { w, h } = size()
          for (const b of s.balloons) {
            const p = project(b)
            const d = Math.hypot(tip.x - p.x, tip.y - p.y)
            if (d < 220) {
              const k = 1 - d / 220
              b.vx += (s.pan.vx / (w * 0.42 / b.z)) * 0.55 * k
              b.vy += (s.pan.vy / (h * 0.38 / b.z)) * 0.55 * k
            }
          }
        }
        s.grabAt = null
      }
    } else {
      s.grabAt = null
    }
    s.pinching = pinch

    // 挤压：捏合且指尖靠近某个球时，球沿"指尖→球心"方向被压扁
    for (const b of s.balloons) {
      const p = project(b)
      const d = tip ? Math.hypot(tip.x - p.x, tip.y - p.y) : 1e9
      const near = clamp(1 - d / (p.r * 2.4), 0, 1)
      const want = pinch && d < p.r * 1.9 ? near : 0
      b.sq = lerp(b.sq || 0, want, 1 - Math.exp(-16 * dt))
      if (tip) b.sqAng = Math.atan2(p.y - tip.y, p.x - tip.x)
    }

    // 挤压：捏合且指尖靠近某个球时，球沿"指尖→球心"方向被压扁
    for (const b of s.balloons) {
      const p = project(b)
      const d = tip ? Math.hypot(tip.x - p.x, tip.y - p.y) : 1e9
      const near = clamp(1 - d / (p.r * 2.4), 0, 1)
      const want = pinch && d < p.r * 1.9 ? near : 0
      b.sq = lerp(b.sq || 0, want, 1 - Math.exp(-16 * dt))
      if (tip) b.sqAng = Math.atan2(p.y - tip.y, p.x - tip.x)
    }

    // 球：漂浮 + 边界回弹（世界坐标 ±0.95）
    for (const b of s.balloons) {
      b.seed += dt
      b.x += (b.vx + Math.sin(b.seed * 1.6) * 0.09) * dt
      b.y += (b.vy + Math.cos(b.seed * 2.1) * 0.07) * dt
      // 轻微向中心回落的浮力，避免全飘出画面
      b.y -= 0.018 * dt
      // 撞到"看得见的画面边缘"就反弹（不是固定的世界 ±0.95）
      const { w, h } = size()
      const kx = w * 0.46
      const ky = h * 0.46 * 0.9
      const rr = b.r / b.z
      const halfX = ((w / 2 - rr) * b.z) / kx
      const halfY = ((h / 2 - rr) * b.z) / ky
      const xMin = -halfX - s.pan.x
      const xMax = halfX - s.pan.x
      const yMin = -halfY - s.pan.y
      const yMax = halfY - s.pan.y
      if (b.x < xMin) { b.x = xMin; b.vx = Math.abs(b.vx) * 0.85 }
      if (b.x > xMax) { b.x = xMax; b.vx = -Math.abs(b.vx) * 0.85 }
      if (b.y < yMin) { b.y = yMin; b.vy = Math.abs(b.vy) * 0.85 }
      if (b.y > yMax) { b.y = yMax; b.vy = -Math.abs(b.vy) * 0.85 }
      b.vx *= Math.pow(0.82, dt)
      b.vy *= Math.pow(0.82, dt)
    }

    // 连击窗口：3 秒没爆就断
    if (s.t - (s.lastPop || 0) > 3) s.combo = 0

    for (const p of s.particles) {
      p.life += dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 620 * dt
      p.vx *= Math.pow(0.15, dt)
    }
    s.particles = s.particles.filter((p) => p.life < p.ttl)

    for (const sh of s.shards) {
      sh.life += dt
      sh.x += sh.vx * dt
      sh.y += sh.vy * dt
      sh.vy += 900 * dt
      sh.vx *= Math.pow(0.2, dt)
      sh.rot += sh.vr * dt
    }
    s.shards = s.shards.filter((sh) => sh.life < sh.ttl)

    for (const sh of s.shards) {
      sh.life += dt
      sh.x += sh.vx * dt
      sh.y += sh.vy * dt
      sh.vy += 900 * dt
      sh.vx *= Math.pow(0.2, dt)
      sh.rot += sh.vr * dt
    }
    s.shards = s.shards.filter((sh) => sh.life < sh.ttl)

    for (const r of s.ripples) r.life += dt
    s.ripples = s.ripples.filter((r) => r.life < r.ttl)

    for (const fl of s.flashes) fl.life += dt
    s.flashes = s.flashes.filter((fl) => fl.life < fl.ttl)

    s.pan.x *= Math.pow(0.6, dt)
    s.pan.y *= Math.pow(0.6, dt)
    s.shake *= Math.pow(0.0015, dt)

    pushHud()
  }

  function pushHud() {
    const now = performance.now()
    if (!pushHud.last || now - pushHud.last > 90) {
      pushHud.last = now
      onHud?.({
        time: Math.max(0, s.duration - s.t),
        score: s.score,
        active: s.balloons.length,
        combo: s.combo,
        pinching: s.pinching,
        detected: Boolean(s.hands[0]?.detected),
      })
    }
  }

  // ---------------------------------------------------------------- 绘制

  function drawBackdrop() {
    const { w, h } = size()
    const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.78)
    g.addColorStop(0, '#6d28c9')
    g.addColorStop(0.45, '#4b1b96')
    g.addColorStop(1, '#1b0736')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    for (const st of s.stars) {
      st.a = 0.35 + 0.35 * Math.sin(s.t * st.tw + st.x * 12)
      ctx.globalAlpha = st.a
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(st.x * w, st.y * h, st.r, 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function drawBalloon(b) {
    const p = project(b)
    const { w, h } = size()
    if (p.x < -p.r * 2.6 || p.x > w + p.r * 2.6) return
    if (p.y < -p.r * 2.6 || p.y > h + p.r * 2.6) return

    const sq = b.sq || 0
    const r = p.r
    const h0 = b.hue

    // 球体：沿"指尖→球心"方向压扁，垂直方向鼓起
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(b.sqAng || 0)
    ctx.scale(1 - 0.3 * sq, 1 + 0.28 * sq)
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.34, r * 0.06, 0, 0, r * 1.05)
    grad.addColorStop(0, `hsl(${h0} 92% 78%)`)
    grad.addColorStop(0.4, `hsl(${h0} 82% 58%)`)
    grad.addColorStop(0.85, `hsl(${h0 + 8} 72% 38%)`)
    grad.addColorStop(1, `hsl(${h0 + 12} 66% 26%)`)
    ctx.save()
    ctx.shadowColor = `hsla(${h0} 90% 30% / 0.55)`
    ctx.shadowBlur = 26 / b.z
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, TAU)
    ctx.fill()
    ctx.restore()
    ctx.restore()

    // 高光 / 嘴 / 打结都画在屏幕坐标系：光线方向不该跟着球转
    ctx.globalAlpha = 0.5
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.ellipse(p.x - r * 0.31, p.y - r * 0.37, r * 0.19, r * 0.12, -0.6, 0, TAU)
    ctx.fill()
    ctx.globalAlpha = 1

    ctx.fillStyle = `hsl(${h0 + 4} 62% 12% / 0.85)`
    ctx.beginPath()
    ctx.ellipse(p.x + r * 0.2, p.y + r * 0.2, r * 0.19, r * 0.12, -0.5, 0, TAU)
    ctx.fill()

    ctx.fillStyle = `hsl(${h0 + 10} 70% 30%)`
    ctx.beginPath()
    ctx.moveTo(p.x - r * 0.05, p.y + r * 0.93)
    ctx.lineTo(p.x + r * 0.19, p.y + r * 1.16)
    ctx.lineTo(p.x + r * 0.22, p.y + r * 0.9)
    ctx.closePath()
    ctx.fill()
  }

  function drawHand(hand) {
    const { w, h } = size()
    const pts = hand.skeleton.map((p) => toScreen(p.x, p.y))
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.strokeStyle = 'rgba(150, 225, 255, 0.85)'
    ctx.lineWidth = 1.6
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath()
      ctx.moveTo(pts[a].x, pts[a].y)
      ctx.lineTo(pts[b].x, pts[b].y)
      ctx.stroke()
    }

    ctx.fillStyle = '#eaf8ff'
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 2.1, 0, TAU)
      ctx.fill()
    }

    // 指尖小光芒
    for (const i of TIPS) {
      const p = pts[i]
      ctx.strokeStyle = 'rgba(150, 225, 255, 0.5)'
      ctx.lineWidth = 1
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k - 1) * 0.42
        ctx.beginPath()
        ctx.moveTo(p.x + Math.cos(a) * 5, p.y + Math.sin(a) * 5)
        ctx.lineTo(p.x + Math.cos(a) * 12, p.y + Math.sin(a) * 12)
        ctx.stroke()
      }
    }

    // 捏合时在"拇指-食指中点"画一圈：这才是真正夹住东西的位置
    const c = { x: (pts[4].x + pts[8].x) / 2, y: (pts[4].y + pts[8].y) / 2 }
    if (hand.g < 0.32) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(c.x, c.y, 10 + Math.sin(s.t * 18) * 1.5, 0, TAU)
      ctx.stroke()
    } else {
      ctx.strokeStyle = 'rgba(180,235,255,0.45)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(c.x, c.y, 6, 0, TAU)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath()
    ctx.arc(c.x, c.y, 2.2, 0, TAU)
    ctx.fill()
    return w && h
  }

  function draw() {
    const { w, h } = size()
    ctx.save()
    if (s.shake > 0.4) {
      ctx.translate(rand(-s.shake, s.shake) * 0.45, rand(-s.shake, s.shake) * 0.45)
    }
    drawBackdrop()

    // 远的先画
    const ordered = [...s.balloons].sort((a, b) => b.z - a.z)
    for (const b of ordered) drawBalloon(b)

    for (const fl of s.flashes) {
      const k = fl.life / fl.ttl
      const g2 = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, fl.r * (1 + k * 1.8))
      g2.addColorStop(0, `rgba(255,255,255,${0.85 * (1 - k)})`)
      g2.addColorStop(0.45, `hsla(${fl.hue} 100% 80% / ${0.5 * (1 - k)})`)
      g2.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g2
      ctx.beginPath()
      ctx.arc(fl.x, fl.y, fl.r * (1 + k * 1.8), 0, TAU)
      ctx.fill()
    }

    for (const r of s.ripples) {
      const k = r.life / r.ttl
      ctx.globalAlpha = (1 - k) * 0.8
      ctx.strokeStyle = `hsl(${r.hue} 100% 78%)`
      ctx.lineWidth = 2.5 * (1 - k) + 0.5
      ctx.beginPath()
      ctx.arc(r.x, r.y, r.r + k * r.r * 2.6, 0, TAU)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    for (const p of s.particles) {
      const k = 1 - p.life / p.ttl
      ctx.globalAlpha = Math.max(0, k)
      ctx.fillStyle = `hsl(${p.hue} 95% ${62 + k * 20}%)`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r * (0.5 + k * 0.9), 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    for (const sh of s.shards) {
      const k = 1 - sh.life / sh.ttl
      ctx.save()
      ctx.globalAlpha = Math.max(0, k)
      ctx.translate(sh.x, sh.y)
      ctx.rotate(sh.rot)
      ctx.fillStyle = `hsl(${sh.hue} 85% ${50 + k * 24}%)`
      ctx.beginPath()
      sh.pts.forEach(([px, py], i) => {
        const X = px * sh.size
        const Y = py * sh.size
        if (i) ctx.lineTo(X, Y)
        else ctx.moveTo(X, Y)
      })
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    ctx.globalAlpha = 1

    for (const sh of s.shards) {
      const k = 1 - sh.life / sh.ttl
      ctx.save()
      ctx.globalAlpha = Math.max(0, k)
      ctx.translate(sh.x, sh.y)
      ctx.rotate(sh.rot)
      ctx.fillStyle = `hsl(${sh.hue} 85% ${50 + k * 24}%)`
      ctx.beginPath()
      sh.pts.forEach(([px, py], i) => {
        const X = px * sh.size
        const Y = py * sh.size
        if (i) ctx.lineTo(X, Y)
        else ctx.moveTo(X, Y)
      })
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    ctx.globalAlpha = 1

    for (const hand of s.hands) {
      if (!hand.detected) continue
      if (hand.skeleton) {
        drawHand(hand)
      } else {
        // 鼠标/触摸没有骨架，画个准星代替
        const c = toScreen(hand.tipX, hand.tipY)
        const on = hand.g < 0.32
        ctx.strokeStyle = on ? 'rgba(255,255,255,0.95)' : 'rgba(180,235,255,0.7)'
        ctx.lineWidth = on ? 2 : 1.4
        ctx.beginPath()
        ctx.arc(c.x, c.y, on ? 13 : 9, 0, TAU)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(c.x - 4, c.y)
        ctx.lineTo(c.x + 4, c.y)
        ctx.moveTo(c.x, c.y - 4)
        ctx.lineTo(c.x, c.y + 4)
        ctx.stroke()
      }
    }

    ctx.restore()
    // 边缘暗角
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, 'rgba(10,2,26,0.55)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, w, h)
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

  function finish() {
    if (!running) return
    running = false
    if (raf) cancelAnimationFrame(raf)
    onEnd?.({
      score: s.score,
      popped: s.popped,
      maxCombo: s.maxCombo,
      time: Math.min(s.duration, s.t),
      perMinute: (s.score / Math.max(1, Math.min(s.duration, s.t))) * 60,
    })
  }

  makeStars()
  for (let i = 0; i < 8; i++) spawn(true)

  return {
    start() {
      resize()
      sfx.ensure() // 必须在用户点击的调用栈里解锁 AudioContext
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
      pushHud() // 开打之前也让 HUD 显示真实的在场球数，否则一直是 0
    },
    /** hands: [{detected, g, skeleton:[{x,y}], tipX, tipY}] 归一化且已镜像 */
    setHands(hands) {
      s.hands = hands
    },
    getState: () => s,
    finish,
  }
}
