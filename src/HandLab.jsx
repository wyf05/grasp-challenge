import { useEffect, useRef, useState } from 'react'
import { drawHand, handTips } from './hand.js'

const STATES = [1, 0.75, 0.5, 0.25, 0]

function drawStrip(canvas) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const slot = w / STATES.length

  STATES.forEach((g, i) => {
    const cx = slot * i + slot * 0.5
    const cy = h * 0.5

    const { finger, thumb } = handTips({ g })

    // 参考线：两颚之间的开口
    ctx.strokeStyle = 'rgba(0,0,0,0.10)'
    ctx.setLineDash([4, 5])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx + finger[0], cy + finger[1])
    ctx.lineTo(cx + thumb[0], cy + thumb[1])
    ctx.stroke()
    ctx.setLineDash([])

    drawHand(ctx, { g, x: cx - 20, y: cy, scale: 0.86 })

    // 标注
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.font = '11px Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('g = ' + g.toFixed(2), cx, h - 22)
    const gap = Math.hypot(finger[0] - thumb[0], finger[1] - thumb[1])
    ctx.fillStyle = 'rgba(0,0,0,0.62)'
    ctx.font = '500 12px Inter, sans-serif'
    ctx.fillText('开口 ' + gap.toFixed(0), cx, h - 6)
  })
}

function drawSingle(canvas, g, t) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  drawHand(ctx, { g, t, x: w * 0.45, y: h * 0.44, scale: 1.5, shadow: true })
}

export default function HandLab() {
  const stripRef = useRef(null)
  const singleRef = useRef(null)
  const [g, setG] = useState(1)
  const [t, setT] = useState(0)

  useEffect(() => {
    if (stripRef.current) drawStrip(stripRef.current)
  }, [])

  useEffect(() => {
    if (singleRef.current) drawSingle(singleRef.current, g, t)
  }, [g, t])

  return (
    <div style={{ padding: '24px 24px 48px', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
        机械手 · 形态调参台
      </h1>
      <p style={{ fontSize: 13, color: 'rgba(0,0,0,.45)', margin: '0 0 20px' }}>
        g = 1 完全张开，g = 0 完全合拢。虚线是两颚的连线，数字是开口大小（像素）。
        合拢时开口应接近最小物体尺寸（约 10），否则会出现「判定抓住了、画面上还有缝」的割裂感。
      </p>

      <canvas ref={stripRef} style={{ width: '100%', height: 340, display: 'block' }} />

      <div style={{ display: 'flex', gap: 28, marginTop: 28, flexWrap: 'wrap' }}>
        <canvas
          ref={singleRef}
          style={{ flex: '1 1 420px', height: 380, background: '#fafafa', borderRadius: 16 }}
        />
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <label style={{ fontSize: 12, color: 'rgba(0,0,0,.55)' }}>
            开合 g：<b style={{ fontSize: 18, color: '#0a0a0a' }}>{g.toFixed(2)}</b>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={g}
              onChange={(e) => setG(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#0a0a0a', marginTop: 6 }}
            />
          </label>
          <label style={{ fontSize: 12, color: 'rgba(0,0,0,.55)' }}>
            拇指轴 t：<b style={{ fontSize: 18, color: '#0a0a0a' }}>{t.toFixed(2)}</b>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={t}
              onChange={(e) => setT(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#0a0a0a', marginTop: 6 }}
            />
          </label>
          <p style={{ fontSize: 12, lineHeight: 1.7, color: 'rgba(0,0,0,.45)', margin: 0 }}>
            拇指轴是给高手拿「完美抓取」的隐藏第二轴：不调也能玩，调准多 50% 分。
            当前实现里它只对拇指额外加 25% 弯曲量，等玩法定下来再细化。
          </p>
        </div>
      </div>
    </div>
  )
}
