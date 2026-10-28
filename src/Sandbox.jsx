import { useCallback, useEffect, useRef, useState } from 'react'
import { createPurge } from './sandbox/purge.js'

const CAM_TIPS = {
  idle: '打开摄像头',
  loading: '正在加载识别引擎…',
  permission: '等待授权…',
  ready: '已识别',
  error: '摄像头不可用',
}

const mmss = (t) => {
  const s = Math.max(0, Math.ceil(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function Sandbox({ onExit }) {
  const [camStatus, setCamStatus] = useState('idle')
  const [camError, setCamError] = useState('')
  const [detected, setDetected] = useState(false)
  const [phase, setPhase] = useState('ready')
  const [result, setResult] = useState(null)
  const [hud, setHud] = useState({ time: 60, score: 0, active: 0, combo: 0 })

  const purgeCanvas = useRef(null)
  const videoRef = useRef(null)
  const purgeRef = useRef(null)
  const camRef = useRef(null)
  const handRef = useRef(null)
  const pointerRef = useRef({ x: 0.5, y: 0.5, down: false, seen: false })

  // ---------- 引擎 ----------
  const build = useCallback(() => {
    if (purgeRef.current || !purgeCanvas.current) return purgeRef.current
    const g = createPurge({
      canvas: purgeCanvas.current,
      onHud: setHud,
      onEnd: (r) => {
        setPhase('over')
        setResult(r)
      },
    })
    purgeRef.current = g
    if (import.meta.env.DEV) window.__purge = g
    g.render()
    return g
  }, [])

  useEffect(() => {
    const g = build()
    g?.resize?.()
    const onResize = () => purgeRef.current?.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      g?.stop?.()
    }
  }, [build])

  // ---------- 摄像头 ----------
  const enableCamera = useCallback(async () => {
    if (camRef.current) return
    setCamStatus('loading')
    const { createCameraInput } = await import('./game/camera.js')
    const cam = await createCameraInput({
      video: videoRef.current,
      overlay: null,
      onValue: (v) => {
        if (!v.detected || !v.skeleton) {
          handRef.current = null
          setDetected(false)
          return
        }
        setDetected(true)
        // camera.js 给未镜像坐标，这里翻一次；判定点取拇指尖与食指尖的中点，
        // 也就是"捏住"时实际夹住东西的那个位置
        const sk = v.skeleton.map((p) => ({ x: 1 - p.x, y: p.y }))
        const thumb = sk[4]
        const index = sk[8]
        handRef.current = {
          detected: true,
          g: v.g,
          skeleton: sk,
          tipX: (thumb.x + index.x) / 2,
          tipY: (thumb.y + index.y) / 2,
        }
      },
      onStatus: (st, extra) => {
        setCamStatus(st)
        if (st === 'error') setCamError(extra || '')
      },
    })
    camRef.current = cam
    const ok = await cam.start()
    if (!ok) camRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      camRef.current?.stop()
      camRef.current = null
    }
  }, [])

  // 输入喂给引擎：优先真手，没有就用鼠标/触摸当虚拟手指
  useEffect(() => {
    let raf = null
    const tick = () => {
      const p = pointerRef.current
      const hand = handRef.current
      const virtual =
        (!hand || !detected) && p.seen
          ? { detected: true, g: p.down ? 0.1 : 0.9, skeleton: null, tipX: p.x, tipY: p.y }
          : null
      purgeRef.current?.setHands(hand ? [hand] : virtual ? [virtual] : [])
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [detected])

  // ---------- 交互 ----------
  const setPointer = (e, down) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    pointerRef.current = {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
      down: down ?? pointerRef.current.down,
      seen: true,
    }
  }

  const start = () => {
    build()
    setResult(null)
    setPhase('playing')
    purgeRef.current?.start()
  }

  const back = () => {
    purgeRef.current?.stop()
    setPhase('ready')
    purgeRef.current?.render()
  }

  const camOn = camStatus === 'ready'
  const playing = phase === 'playing'
  const asking = phase === 'ready' && camStatus !== 'ready'

  return (
    <div className="sandbox">
      <header className="sandbox-bar">
        <button className="sandbox-icon" onClick={onExit} aria-label="返回首页">
          ‹
        </button>
        <span className="sandbox-name">捏气球</span>
        <button
          className={'sandbox-cam' + (camOn ? ' is-on' : '')}
          onClick={enableCamera}
          disabled={camOn || camStatus === 'loading'}
        >
          {camOn ? (detected ? '已识别到手' : '举手对准镜头') : CAM_TIPS[camStatus] || '打开摄像头'}
        </button>
      </header>

      <div className="purge-hud">
        <div className="purge-stat">
          <span className="purge-label">
            <i className="purge-dot" /> 在场气球
          </span>
          <b>{hud.active}</b>
        </div>
        <div className="purge-stat purge-stat--mid">
          <span className="purge-label">剩余时间</span>
          <b className={hud.time <= 10 ? 'is-low' : ''}>{mmss(hud.time)}</b>
        </div>
        <div className="purge-stat purge-stat--right">
          <span className="purge-label">已捏爆</span>
          <b>{hud.popped ?? 0}</b>
        </div>
      </div>

      <div className="purge-stage">
        <canvas
          ref={purgeCanvas}
          className="purge-canvas"
          onPointerMove={(e) => setPointer(e)}
          onPointerDown={(e) => setPointer(e, true)}
          onPointerUp={(e) => setPointer(e, false)}
          onPointerLeave={(e) => setPointer(e, false)}
        />
        {hud.combo > 2 && playing && <div className="purge-combo">连击 ×{hud.combo}</div>}

        {phase === 'ready' && (
          <div className="sandbox-overlay">
            <div className="sandbox-card">
              <span className="sandbox-eyebrow">Stress purge</span>

              {asking ? (
                <>
                  <h2>{camStatus === 'loading' || camStatus === 'permission' ? '正在启动摄像头…' : '要打开摄像头吗？'}</h2>
                  <p>
                    {camStatus === 'loading' || camStatus === 'permission'
                      ? '浏览器会弹出权限询问，点「允许」就行。'
                      : '打开后用手直接捏；不打开也能用鼠标按住当捏合。'}
                  </p>
                  {camStatus === 'error' && (
                    <p className="sandbox-err">{camError}</p>
                  )}
                  <div className="sandbox-actions">
                    {camStatus === 'idle' || camStatus === 'error' ? (
                      <>
                        <button className="btn btn--primary" onClick={enableCamera}>
                          {camStatus === 'error' ? '重试' : '打开摄像头'}
                        </button>
                        <button className="btn btn--ghost" onClick={start}>
                          先用鼠标玩
                        </button>
                      </>
                    ) : (
                      <button className="btn btn--ghost" onClick={start}>
                        跳过，用鼠标玩
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <h2>拇指碰到才炸。</h2>
                  <p>
                    <b>捏住</b>（拇指和食指合上），指尖<b>碰到气球就炸</b>。一次捏合只爆一个。
                  </p>
                  <p className="sandbox-sub">
                    {detected ? '已经看到你的手了。' : '把整只手放进画面，离镜头 40–60cm。'}
                  </p>
                  <div className="sandbox-actions">
                    <button className="btn btn--primary" onClick={start}>
                      开始 60 秒
                    </button>
                    <button className="btn btn--ghost" onClick={start}>
                      用鼠标玩
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {phase === 'over' && result && (
          <div className="sandbox-overlay">
            <div className="sandbox-card">
              <span className="sandbox-eyebrow">Stress purged</span>
              <b className="purge-score">{result.score}</b>
              <span className="sandbox-sub">
                捏爆 {result.popped} 个 · 最高连击 {result.maxCombo} ·{' '}
                {Math.round(result.perMinute)} 分/分钟
              </span>
              <div className="sandbox-actions">
                <button className="btn btn--primary" onClick={start}>
                  再来一局
                </button>
                <button className="btn btn--ghost" onClick={back}>
                  返回
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="purge-foot">
        <span className="purge-chip">捏住 → 拇指碰到气球</span>
        <span className="purge-chip">{hud.combo > 0 ? '连击中' : '准备'}</span>
        <span className="purge-hint">一次捏合只爆一个，连爆连击更高</span>
      </div>

      <video ref={videoRef} className="cam-video is-hidden" playsInline muted />
    </div>
  )
}
