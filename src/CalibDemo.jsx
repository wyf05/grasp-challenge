import { useEffect, useRef } from 'react'
import { drawHand } from './hand.js'

/**
 * 校准示范：用同一只机械手做"张开 / 握拳"的循环演示，
 * 让用户照着做，而不是只读一行字。
 */
export default function CalibDemo({ step = 'open', width = 300, height = 150 }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    let raf = 0
    const t0 = performance.now()

    const loop = (ts) => {
      const t = (ts - t0) / 1000
      const wave = 0.5 - 0.5 * Math.cos(t * 2.1) // 0→1→0
      const g = step === 'fist' ? wave * 0.07 : 1 - wave * 0.07

      ctx.clearRect(0, 0, width, height)
      drawHand(ctx, { g, x: width * 0.52, y: height * 0.52, scale: 0.78 })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [step, width, height])

  return (
    <canvas
      ref={ref}
      style={{ width: width + 'px', height: height + 'px', display: 'block' }}
      aria-hidden="true"
    />
  )
}
