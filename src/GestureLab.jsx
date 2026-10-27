import { useEffect, useRef, useState, useCallback } from 'react'
import { createCameraInput } from './game/camera.js'

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]

const FINGERS = [
  { key: 'thumb', name: '拇指', chain: [2, 3, 4] },
  { key: 'index', name: '食指', chain: [5, 6, 7, 8] },
  { key: 'middle', name: '中指', chain: [9, 10, 11, 12] },
  { key: 'ring', name: '无名指', chain: [13, 14, 15, 16] },
  { key: 'pinky', name: '小指', chain: [17, 18, 19, 20] },
]

const GESTURES = [
  { key: 'open', name: '张开', hint: '五指伸直' },
  { key: 'fist', name: '握拳', hint: '五指收拢' },
  { key: 'pinch', name: '捏合', hint: '拇指食指相触' },
  { key: 'ok', name: 'OK', hint: '捏合 + 三指伸直' },
  { key: 'victory', name: '剪刀手', hint: '食指中指伸直' },
]

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * 指头伸直程度：指尖到指根距离 ÷ 各节骨长之和（0 蜷缩 → 1 伸直），与手的方向无关。
 * 注意：四指是 4 个点（3 节），拇指只有 3 个点（2 节），
 * 所以这里必须按实际点数求和，不能写死解构四个。
 */
function straightness(lm, chain) {
  const pts = chain.map((i) => lm[i])
  if (pts.some((p) => !p)) return 0
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) total += dist(pts[i], pts[i + 1])
  return total > 1e-6 ? Math.min(1, dist(pts[0], pts[pts.length - 1]) / total) : 0
}

function classify(lm) {
  const palmW = dist(lm[5], lm[17]) || 1
  const s = {}
  for (const f of FINGERS) s[f.key] = straightness(lm, f.chain)
  const pinchGap = dist(lm[4], lm[8]) / palmW

  const fourUp = s.index > 0.74 && s.middle > 0.74 && s.ring > 0.74 && s.pinky > 0.74
  const fourDown = s.index < 0.56 && s.middle < 0.56 && s.ring < 0.56 && s.pinky < 0.56

  let current = null
  if (pinchGap < 0.3 && s.middle > 0.72 && s.ring > 0.72 && s.pinky > 0.72) current = 'ok'
  else if (pinchGap < 0.3) current = 'pinch'
  else if (s.index > 0.75 && s.middle > 0.75 && s.ring < 0.56 && s.pinky < 0.56) current = 'victory'
  else if (fourUp && s.thumb > 0.6) current = 'open'
  else if (fourDown) current = 'fist'

  return { current, s, pinchGap }
}

// 开发期调试钩子：可以在控制台直接验证手势判定
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  window.__classify = (lm) => classify(lm)
}

export default function GestureLab({ onExit }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const camRef = useRef(null)
  const holdRef = useRef({ key: null, since: 0 })
  const lastRef = useRef({ lm: null, at: 0 })

  const [status, setStatus] = useState('idle')
  const [live, setLive] = useState({
    g: 0,
    t: 0,
    nx: 0,
    ny: 0,
    fps: 0,
    ms: 0,
    current: null,
    s: {},
  })
  const [unlocked, setUnlocked] = useState({})
  const [detected, setDetected] = useState(false)
  const [errMsg, setErrMsg] = useState('')

  // ---------- 画骨架 ----------
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video || !video.videoWidth) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    if (canvas.width !== Math.round(rect.width * dpr)) {
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
    }
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const w = rect.width
    const h = rect.height
    ctx.clearRect(0, 0, w, h)

    const lm = lastRef.current.lm
    if (!lm || performance.now() - lastRef.current.at > 400) return

    // 归一化 → 画布坐标（覆盖裁切 + 水平镜像，与视频显示一致）
    const vw = video.videoWidth
    const vh = video.videoHeight
    const sc = Math.max(w / vw, h / vh)
    const dw = vw * sc
    const dh = vh * sc
    const dx = (w - dw) / 2
    const dy = (h - dh) / 2
    const toXY = (p) => ({ x: w - (dx + p.x * dw), y: dy + p.y * dh })
    const pts = lm.map(toXY)

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 5
    ctx.beginPath()
    for (const [a, b] of BONES) {
      ctx.moveTo(pts[a].x, pts[a].y)
      ctx.lineTo(pts[b].x, pts[b].y)
    }
    ctx.stroke()

    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    for (const [a, b] of BONES) {
      ctx.moveTo(pts[a].x, pts[a].y)
      ctx.lineTo(pts[b].x, pts[b].y)
    }
    ctx.stroke()

    for (let i = 0; i < pts.length; i++) {
      const tip = [4, 8, 12, 16, 20].includes(i)
      ctx.beginPath()
      ctx.arc(pts[i].x, pts[i].y, tip ? 5.5 : 3.4, 0, Math.PI * 2)
      ctx.fillStyle = tip ? '#FFFFFF' : 'rgba(255,255,255,0.9)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
  }, [])

  // ---------- 启动摄像头 ----------
  const start = async () => {
    setErrMsg('')
    // 已经创建过就直接重试启动，不用重新加载模型
    if (camRef.current) {
      setStatus('loading')
      await camRef.current.start()
      return
    }
    const cam = await createCameraInput({
      video: videoRef.current,
      overlay: null,
      onStatus: (s, msg) => {
        setStatus(s)
        if (msg) setErrMsg(msg)
      },
      onValue: (v) => {
        try {
        if (!v.detected) {
          lastRef.current.lm = null
          setDetected(false)
          // 没手的时候也要更新 fps / 耗时，否则面板一直显示 0
          setLive((prev) => ({ ...prev, fps: v.fps || 0, ms: v.ms || 0, current: null }))
          return
        }
        setDetected(true)
        lastRef.current = { lm: v.skeleton, at: performance.now() }
        const { current, s } = classify(v.skeleton)

        // 需要稳定按住 260ms 才算完成，避免抖一下就点亮
        const now = performance.now()
        const hold = holdRef.current
        if (current && hold.key === current) {
          if (now - hold.since > 260) {
            setUnlocked((u) => (u[current] ? u : { ...u, [current]: true }))
          }
        } else {
          holdRef.current = { key: current, since: now }
        }

        setLive({
          g: v.g,
          t: v.t,
          nx: v.nx,
          ny: v.ny,
          fps: v.fps || 0,
          ms: v.ms || 0,
          current,
          s,
        })
        } catch (e) {
          console.warn('[gesture] 处理异常', e)
        }
      },
    })
    camRef.current = cam
    await cam.start()
  }

  useEffect(() => {
    let raf = 0
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      camRef.current?.stop()
      camRef.current = null
    }
  }, [draw])

  const cur = live.current ? GESTURES.find((g) => g.key === live.current) : null
  const ready = status === 'ready'

  return (
    <div className="gl">
      <header className="gl-head">
        <button className="game-back" onClick={onExit} aria-label="返回">
          ←
        </button>
        <div>
          <span className="gl-eyebrow">GESTURE LAB</span>
          <h1 className="gl-title">看见 AI 怎么理解你的手</h1>
        </div>
        <div className="gl-status">
          <i className={ready ? 'on' : ''} />
          {status === 'ready' ? '识别中' : status === 'loading' ? '加载引擎' : status === 'permission' ? '等待授权' : status === 'error' ? '启动失败' : '未启动'}
        </div>
      </header>

      <div className="gl-main">
        <div className="gl-stage">
          <video ref={videoRef} playsInline muted autoPlay />
          <canvas ref={canvasRef} />
          {!ready && (
            <div className="gl-gate">
              {status === 'error' ? (
                <div className="gl-error">
                  <b>摄像头启动失败</b>
                  <p>{errMsg || '未知原因'}</p>
                  <button className="btn btn--primary" onClick={start}>
                    重试
                  </button>
                </div>
              ) : (
                <button className="btn btn--primary" onClick={start}>
                  开启摄像头
                </button>
              )}
            </div>
          )}
          {ready && !detected && (
            <div className="gl-hint">把手抬到画面里 · 离镜头 40–60cm</div>
          )}
          {ready && cur && <div className="gl-current">{cur.name}</div>}
        </div>

        <aside className="gl-panel">
          <div className="gl-metrics">
            <div>
              <span>开合度</span>
              <b>{live.g.toFixed(2)}</b>
            </div>
            <div>
              <span>拇指轴</span>
              <b>{live.t.toFixed(2)}</b>
            </div>
            <div>
              <span>追踪帧率</span>
              <b>{live.fps} fps</b>
            </div>
            <div>
              <span>单帧耗时</span>
              <b>{live.ms.toFixed(0)} ms</b>
            </div>
          </div>

          <div className="gl-fingers">
            <span className="gl-sub">五指伸直程度</span>
            {FINGERS.map((f) => {
              const v = live.s[f.key] || 0
              return (
                <div className="gl-bar" key={f.key}>
                  <span>{f.name}</span>
                  <i>
                    <b style={{ width: Math.round(v * 100) + '%' }} />
                  </i>
                  <em>{v.toFixed(2)}</em>
                </div>
              )
            })}
          </div>
        </aside>
      </div>

      <div className="gl-gestures">
        <span className="gl-sub">做出手势即点亮</span>
        <div className="gl-cards">
          {GESTURES.map((g) => (
            <div
              key={g.key}
              className={
                'gl-card' +
                (unlocked[g.key] ? ' is-done' : '') +
                (live.current === g.key ? ' is-live' : '')
              }
            >
              <b>{g.name}</b>
              <span>{g.hint}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
