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
      vx: rand(-0.05, 0.05),
      vy: rand(-0.12, -0.04),
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

    const n = 22
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
    s.ripples.push({ x: p.x, y: p.y, r: p.r * 0.5, life: 0, ttl: 0.42, hue: b.hue })
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
      }

      if (pinch) {
        // 捏合中：指尖在球内就爆，否则拖拽平移视角
        let hit = null
        for (const b of s.balloons) {
          const p = project(b)
          if (Math.hypot(tip.x - p.x, tip.y - p.y) < p.r * 0.92) {
            if (!hit || b.z < hit.b.z) hit = b
          }
        }
        if (hit) {
          pop(hit, tip.x, tip.y)
        } else if (s.grabAt) {
          const dx = tip.x - s.grabAt.x
          const dy = tip.y - s.grabAt.y
          const { w, h } = size()
          s.pan.x += (dx / (w * 0.42)) * 0.55
          s.pan.y += (dy / (h * 0.38)) * 0.55
          s.pan.vx = dx / Math.max(dt, 1e-3)
          s.pan.vy = dy / Math.max(dt, 1e-3)
          s.grabAt = { ...tip, t: s.t }
        }
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

    // 球：漂浮 + 边界回弹（世界坐标 ±0.95）
    for (const b of s.balloons) {
      b.seed += dt
      b.x += (b.vx + Math.sin(b.seed * 0.9) * 0.012) * dt
      b.y += (b.vy + Math.cos(b.seed * 1.3) * 0.008) * dt
      // 轻微向中心回落的浮力，避免全飘出画面
      b.y -= 0.035 * dt
      if (b.x < -0.95) { b.x = -0.95; b.vx = Math.abs(b.vx) }
      if (b.x > 0.95) { b.x = 0.95; b.vx = -Math.abs(b.vx) }
      if (b.y < -0.95) { b.y = -0.95; b.vy = Math.abs(b.vy) }
      if (b.y > 0.95) { b.y = 0.95; b.vy = -Math.abs(b.vy) }
      b.vx *= Math.pow(0.35, dt)
      b.vy *= Math.pow(0.35, dt)
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

    for (const r of s.ripples) r.life += dt
    s.ripples = s.ripples.filter((r) => r.life < r.ttl)

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
    if (p.x < -p.r * 2 || p.x > size().w + p.r * 2) return
    if (p.y < -p.r * 2 || p.y > size().h + p.r * 2) return

    const h0 = b.hue
    const grad = ctx.createRadialGradient(
      p.x - p.r * 0.34,
      p.y - p.r * 0.36,
      p.r * 0.08,
      p.x,
      p.y,
      p.r * 1.05,
    )
    grad.addColorStop(0, `hsl(${h0} 92% 76%)`)
    grad.addColorStop(0.42, `hsl(${h0} 82% 58%)`)
    grad.addColorStop(0.86, `hsl(${h0 + 8} 72% 38%)`)
    grad.addColorStop(1, `hsl(${h0 + 12} 66% 28%)`)

    ctx.save()
    ctx.shadowColor = `hsla(${h0} 90% 30% / 0.55)`
    ctx.shadowBlur = 26 / b.z
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(p.x, p.y, p.r * 0.94, p.r, 0, 0, TAU)
    ctx.fill()
    ctx.restore()

    // 高光
    ctx.globalAlpha = 0.55
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.ellipse(p.x - p.r * 0.33, p.y - p.r * 0.4, p.r * 0.2, p.r * 0.13, -0.6, 0, TAU)
    ctx.fill()
    ctx.globalAlpha = 1

    // 暗色"嘴"缺口，让它像个活物
    ctx.fillStyle = `hsl(${h0 + 4} 62% 12% / 0.85)`
    ctx.beginPath()
    ctx.ellipse(p.x + p.r * 0.2, p.y + p.r * 0.2, p.r * 0.22, p.r * 0.14, -0.5, 0, TAU)
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

    // 捏合时指尖收紧：画一圈提示
    if (hand.g < 0.32) {
      const p = pts[4]
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.arc(p.x, p.y, 9 + Math.sin(s.t * 18) * 1.5, 0, TAU)
      ctx.stroke()
    }
    return w && h
  }

  function draw() {
    const { w, h } = size()
    ctx.save()
    if (s.shake > 0.4) {
      ctx.translate(rand(-s.shake, s.shake) * 0.4, rand(-s.shake, s.shake) * 0.4)
    }
    drawBackdrop()

    // 远的先画
    const ordered = [...s.balloons].sort((a, b) => b.z - a.z)
    for (const b of ordered) drawBalloon(b)

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

    for (const hand of s.hands) {
      if (hand.detected && hand.skeleton) drawHand(hand)
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
    /** hands: [{detected, g, skeleton:[{x,y}], tipX, tipY}] 归一化且已镜像 */
    setHands(hands) {
      s.hands = hands
    },
    getState: () => s,
    finish,
  }
}
