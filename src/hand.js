/**
 * 机械手绘制（Canvas 2D）
 * 参照首页视频里那只哑光黑工业机械手：
 * 横向渐变 + 窄高光带（金属感）、倒角棱线、指节壳体、沉头螺丝、节间暗缝。
 *
 * 侧视「双钳」构图：手掌在左，四指构成上颚向右伸出并向下卷，拇指构成下颚向上合拢。
 * 约定：g = 1 完全张开，g = 0 完全合拢（与 SPEC 一致）
 */

const DEG = Math.PI / 180

export const TUNING = {
  palm: { x: -96, y: -52, w: 96, h: 104, r: 26 },
  fingerRootY: [-34, -12, 10, 29],
  fingerRootX: [0, -7, -13, -18],
  fingerLen: [
    [40, 29, 21],
    [43, 32, 23],
    [39, 28, 20],
    [30, 21, 16],
  ],
  // 每根手指的基准宽度（会逐节收细）
  fingerW: [20, 21, 19, 15],
  // 每指额外的小角度，做出自然扇形
  fingerFan: [-4, 0, 3, 6],
  // 关节角度（度）：a1/a2b/a3b 是静止时的自然弯曲，a1c/a2c/a3c 是合拢时额外增加的
  fingerAngle: { a1: 14, a1c: 21, a2b: 8, a2c: 22, a3b: 6, a3c: 13 },
  thumb: {
    root: [0, 44],
    len: [31, 23],
    w: [24, 19],
    open: [26, 18],
    closed: [-21, -1],
  },
}

const SEG_RATIO = [1, 0.9, 0.78]
const TIP_RATIO = 0.8

/** 金属横向渐变：窄高光带是金属与塑料观感的分界线 */
function metalGrad(ctx, w) {
  const g = ctx.createLinearGradient(0, -w / 2, 0, w / 2)
  g.addColorStop(0.0, '#3D3D48')
  g.addColorStop(0.14, '#1F1F27')
  g.addColorStop(0.3, '#343440')
  g.addColorStop(0.44, '#191920')
  g.addColorStop(0.72, '#101015')
  g.addColorStop(0.9, '#08080B')
  g.addColorStop(1.0, '#040406')
  return g
}

function segPath(ctx, len, w0, w1) {
  ctx.beginPath()
  ctx.moveTo(0, -w0 / 2)
  ctx.lineTo(len, -w1 / 2)
  ctx.arc(len, 0, w1 / 2, -Math.PI / 2, Math.PI / 2, false)
  ctx.lineTo(0, w0 / 2)
  ctx.arc(0, 0, w0 / 2, Math.PI / 2, (Math.PI * 3) / 2, false)
  ctx.closePath()
}

/** 倒角：上缘提亮、下缘压暗，只在形状内部生效 */
function bevel(ctx, len, w0, w1) {
  ctx.save()
  segPath(ctx, len, w0, w1)
  ctx.clip()
  ctx.lineCap = 'round'

  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, -w0 / 2 + 1)
  ctx.lineTo(len, -w1 / 2 + 1)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(0,0,0,0.6)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, w0 / 2 - 1)
  ctx.lineTo(len, w1 / 2 - 1)
  ctx.stroke()

  // 机加工棱线
  ctx.strokeStyle = 'rgba(255,255,255,0.055)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(w0 * 0.3, -w0 * 0.26)
  ctx.lineTo(len - w1 * 0.2, -w1 * 0.26)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(w0 * 0.3, w0 * 0.26)
  ctx.lineTo(len - w1 * 0.2, w1 * 0.26)
  ctx.stroke()

  ctx.restore()
}

function phalanx(ctx, x, y, angleDeg, len, w0, w1, depth) {
  const a = angleDeg * DEG
  ctx.save()
  ctx.globalAlpha = depth
  ctx.translate(x, y)
  ctx.rotate(a)

  segPath(ctx, len, w0, w1)
  ctx.fillStyle = metalGrad(ctx, w0)
  ctx.fill()
  bevel(ctx, len, w0, w1)

  // 节与节之间的暗缝
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(len - 1.2, -w1 * 0.4)
  ctx.lineTo(len - 1.2, w1 * 0.4)
  ctx.stroke()

  ctx.restore()
  return [x + Math.cos(a) * len, y + Math.sin(a) * len]
}

/** 沉头螺丝 */
function screw(ctx, x, y, r, depth) {
  ctx.globalAlpha = depth
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r)
  g.addColorStop(0, '#5A5A68')
  g.addColorStop(0.6, '#242430')
  g.addColorStop(1, '#0C0C11')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(0,0,0,0.7)'
  ctx.lineWidth = 0.9
  ctx.stroke()

  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.lineWidth = Math.max(0.8, r * 0.42)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - r * 0.55, y + r * 0.15)
  ctx.lineTo(x + r * 0.55, y - r * 0.15)
  ctx.stroke()
  ctx.globalAlpha = 1
}

function jointPin(ctx, x, y, r, depth) {
  ctx.globalAlpha = depth
  const g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.38, r * 0.1, x, y, r * 1.05)
  g.addColorStop(0, '#4C4C5A')
  g.addColorStop(0.45, '#22222B')
  g.addColorStop(0.85, '#0C0C11')
  g.addColorStop(1, '#050507')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.globalAlpha = 1
}

export function drawHand(ctx, { g = 1, t = 0, x = 0, y = 0, scale = 1, shadow = false } = {}) {
  const curl = Math.min(1, Math.max(0, 1 - g))
  const { palm } = TUNING

  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)

  // ---- 落地投影 ----
  if (shadow) {
    const sg = ctx.createRadialGradient(6, 96, 8, 6, 96, 130)
    sg.addColorStop(0, 'rgba(18,18,24,0.14)')
    sg.addColorStop(1, 'rgba(18,18,24,0)')
    ctx.fillStyle = sg
    ctx.beginPath()
    ctx.ellipse(6, 96, 132, 34, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // ---- 手腕 ----
  const wristGrad = ctx.createLinearGradient(0, -26, 0, 38)
  wristGrad.addColorStop(0, '#232330')
  wristGrad.addColorStop(0.35, '#141419')
  wristGrad.addColorStop(1, '#07070A')
  ctx.fillStyle = wristGrad
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(palm.x - 32, -22, 50, 58, 18)
  else ctx.rect(palm.x - 32, -22, 50, 58)
  ctx.fill()

  // ---- 手掌 ----
  const palmGrad = ctx.createLinearGradient(0, palm.y, 0, palm.y + palm.h)
  palmGrad.addColorStop(0, '#34343F')
  palmGrad.addColorStop(0.18, '#1D1D25')
  palmGrad.addColorStop(0.55, '#141419')
  palmGrad.addColorStop(1, '#08080B')
  ctx.fillStyle = palmGrad
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(palm.x, palm.y, palm.w, palm.h, palm.r)
  else ctx.rect(palm.x, palm.y, palm.w, palm.h)
  ctx.fill()

  // 掌面盖板 + 四角螺丝
  const plateX = palm.x + 12
  const plateW = palm.w - 26
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(plateX, palm.y + 14, plateW, palm.h - 28, 15)
  else ctx.rect(plateX, palm.y + 14, plateW, palm.h - 28)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = 1
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(plateX + 1.5, palm.y + 15.5, plateW - 3, palm.h - 31, 14)
  else ctx.rect(plateX + 1.5, palm.y + 15.5, plateW - 3, palm.h - 31)
  ctx.stroke()

  ;[
    [plateX + 11, palm.y + 27],
    [plateX + plateW - 11, palm.y + 27],
    [plateX + 11, palm.y + palm.h - 27],
    [plateX + plateW - 11, palm.y + palm.h - 27],
  ].forEach(([sx, sy]) => screw(ctx, sx, sy, 3.1, 1))

  // 掌背高光
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(palm.x + 16, palm.y + 6)
  ctx.lineTo(palm.x + palm.w - 26, palm.y + 6)
  ctx.stroke()

  // ---- 指节壳体 ----
  TUNING.fingerRootY.forEach((fy, i) => {
    const W = TUNING.fingerW[i] * 1.28
    const hx = -14
    const hw = 19
    const hg = ctx.createLinearGradient(0, fy - W / 2, 0, fy + W / 2)
    hg.addColorStop(0, '#3A3A46')
    hg.addColorStop(0.22, '#1E1E26')
    hg.addColorStop(0.5, '#2E2E38')
    hg.addColorStop(1, '#0A0A0D')
    ctx.fillStyle = hg
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(hx, fy - W / 2, hw, W, 7)
    else ctx.rect(hx, fy - W / 2, hw, W)
    ctx.fill()

    ctx.strokeStyle = 'rgba(0,0,0,0.65)'
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(hx + 2.5, fy - W / 2 + 2)
    ctx.lineTo(hx + hw - 2.5, fy - W / 2 + 2)
    ctx.stroke()

    screw(ctx, hx + hw / 2, fy, Math.min(2.6, W * 0.16), 1)
  })

  // ---- 四指：由后往前 ----
  const order = [3, 2, 1, 0]
  for (const i of order) {
    const depth = [1, 0.94, 0.88, 0.83][i]
    let px = TUNING.fingerRootX[i]
    let py = TUNING.fingerRootY[i]
    const lens = TUNING.fingerLen[i]
    const baseW = TUNING.fingerW[i]

    const a = TUNING.fingerAngle
    const fan = TUNING.fingerFan[i]
    const th1 = a.a1 + fan + curl * a.a1c
    const th2 = th1 + a.a2b + curl * a.a2c
    const th3 = th2 + a.a3b + curl * a.a3c
    const angles = [th1, th2, th3]

    for (let s = 0; s < 3; s++) {
      const w0 = baseW * SEG_RATIO[s]
      const w1 = w0 * TIP_RATIO
      jointPin(ctx, px, py, w0 * 0.37, depth)
      ;[px, py] = phalanx(ctx, px, py, angles[s], lens[s], w0, w1, depth)
    }

    // 指尖
    ctx.globalAlpha = depth
    const tipR = baseW * SEG_RATIO[2] * TIP_RATIO * 0.5
    const tg = ctx.createRadialGradient(px - tipR * 0.3, py - tipR * 0.3, tipR * 0.1, px, py, tipR)
    tg.addColorStop(0, '#2E2E38')
    tg.addColorStop(1, '#07070A')
    ctx.fillStyle = tg
    ctx.beginPath()
    ctx.arc(px, py, tipR, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // ---- 拇指 ----
  const th = TUNING.thumb
  const tk = Math.min(1, curl + t * 0.25)
  const ta1 = th.open[0] + (th.closed[0] - th.open[0]) * tk
  const ta2 = th.open[1] + (th.closed[1] - th.open[1]) * tk

  let tx = th.root[0]
  let ty = th.root[1]

  const tW = th.w[0] * 1.5
  const tbg = ctx.createLinearGradient(0, ty - tW / 2, 0, ty + tW / 2)
  tbg.addColorStop(0, '#3A3A46')
  tbg.addColorStop(0.22, '#1E1E26')
  tbg.addColorStop(0.5, '#2E2E38')
  tbg.addColorStop(1, '#0A0A0D')
  ctx.fillStyle = tbg
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(-19, ty - tW / 2, 26, tW, 9)
  else ctx.rect(-19, ty - tW / 2, 26, tW)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.65)'
  ctx.lineWidth = 1.2
  ctx.stroke()
  screw(ctx, -6, ty, 3, 1)

  jointPin(ctx, tx, ty, th.w[0] * 0.32, 1)
  ;[tx, ty] = phalanx(ctx, tx, ty, ta1, th.len[0], th.w[0], th.w[0] * 0.88, 1)
  jointPin(ctx, tx, ty, th.w[1] * 0.3, 1)
  ;[tx, ty] = phalanx(ctx, tx, ty, ta2, th.len[1], th.w[1], th.w[1] * 0.86, 1)

  const tipR2 = th.w[1] * 0.86 * 0.5
  const tg3 = ctx.createRadialGradient(tx - tipR2 * 0.3, ty - tipR2 * 0.3, tipR2 * 0.1, tx, ty, tipR2)
  tg3.addColorStop(0, '#2E2E38')
  tg3.addColorStop(1, '#07070A')
  ctx.fillStyle = tg3
  ctx.beginPath()
  ctx.arc(tx, ty, tipR2, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

/** 仅供调试：返回指尖与拇指尖的坐标（局部坐标系） */
export function handTips({ g = 1 } = {}) {
  const curl = Math.min(1, Math.max(0, 1 - g))
  let px = TUNING.fingerRootX[0]
  let py = TUNING.fingerRootY[0]
  const a = TUNING.fingerAngle
  const th1 = a.a1 + TUNING.fingerFan[0] + curl * a.a1c
  const th2 = th1 + a.a2b + curl * a.a2c
  const th3 = th2 + a.a3b + curl * a.a3c
  const angs = [th1, th2, th3]
  for (let s = 0; s < 3; s++) {
    px += Math.cos(angs[s] * DEG) * TUNING.fingerLen[0][s]
    py += Math.sin(angs[s] * DEG) * TUNING.fingerLen[0][s]
  }

  const tk = curl
  const ta1 = TUNING.thumb.open[0] + (TUNING.thumb.closed[0] - TUNING.thumb.open[0]) * tk
  const ta2 = TUNING.thumb.open[1] + (TUNING.thumb.closed[1] - TUNING.thumb.open[1]) * tk
  let tx = TUNING.thumb.root[0]
  let ty = TUNING.thumb.root[1]
  tx += Math.cos(ta1 * DEG) * TUNING.thumb.len[0]
  ty += Math.sin(ta1 * DEG) * TUNING.thumb.len[0]
  tx += Math.cos(ta2 * DEG) * TUNING.thumb.len[1]
  ty += Math.sin(ta2 * DEG) * TUNING.thumb.len[1]
  return { finger: [px, py], thumb: [tx, ty] }
}
