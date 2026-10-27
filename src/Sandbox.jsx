import { useCallback, useEffect, useRef, useState } from 'react'
import { createPurge } from './sandbox/purge.js'
import { createBloom, loadFlower, FLOWERS } from './sandbox/bloom.js'

const TABS = [
  { key: 'purge', label: 'Stress Purge', cn: '捏气球' },
  { key: 'bloom', label: 'Bloom', cn: '指尖生花' },
]

const CAM_TIPS = {
  idle: '摄像头未启动',
  loading: '正在加载识别引擎…',
  permission: '等待摄像头授权…',
  ready: '识别就绪',
  error: '摄像头不可用',
}

const mmss = (t) => {
  const s = Math.max(0, Math.ceil(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function Sandbox({ onExit }) {
  const [tab, setTab] = useState('purge')
  const [camStatus, setCamStatus] = useState('idle')
  const [detected, setDetected] = useState(false)
  const [phase, setPhase] = useState('ready')
  const [result, setResult] = useState(null)
  const [hud, setHud] = useState({ time: 60, score: 0, active: 0, combo: 0 })
  const [bhud, setBhud] = useState({ bloom: 0, index: 0 })
  const [flowerReady, setFlowerReady] = useState(false)
  // 指尖生花第一次进来要讲一句怎么玩（捏气球那边有 ready 浮层，这边没有）
  const [bloomIntro, setBloomIntro] = useState(() => {
    try {
      return localStorage.getItem('dex.bloom.v1') !== 'off'
    } catch {
      return true
    }
  })

  const closeBloomIntro = () => {
    try {
      localStorage.setItem('dex.bloom.v1', 'off')
    } catch {
      /* 隐私模式下写不了 localStorage，忽略 */
    }
    setBloomIntro(false)
  }

  const purgeCanvas = useRef(null)
  const bloomCanvas = useRef(null)
  const videoRef = useRef(null)
  const overlayRef = useRef(null)
  const purgeRef = useRef(null)
  const bloomRef = useRef(null)
  const camRef = useRef(null)
  const handRef = useRef(null)
  const pointerRef = useRef({ x: 0.5, y: 0.5, down: false, seen: false })
  const tabRef = useRef(tab)
  tabRef.current = tab
  const framesRef = useRef(null)

  // ---------- 引擎 ----------
  const buildPurge = useCallback(() => {
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

  const buildBloom = useCallback(() => {
    if (bloomRef.current || !bloomCanvas.current) return bloomRef.current
    const g = createBloom({ canvas: bloomCanvas.current, onHud: setBhud })
    bloomRef.current = g
    if (import.meta.env.DEV) window.__bloom = g
    g.setFlowers(framesRef.current || [])
    g.render()
    return g
  }, [])

  // 花朵序列按需加载（22 帧 × 2 朵，约 1.6MB）
  useEffect(() => {
    let alive = true
    Promise.all(FLOWERS.map((f) => loadFlower(f)))
      .then((lists) => {
        if (!alive) return
        framesRef.current = lists
        bloomRef.current?.setFlowers(lists)
        setFlowerReady(true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // 花帧就绪 + 在 bloom 页 → 才启动循环
  useEffect(() => {
    if (tab !== 'bloom') return
    if (!flowerReady) return
    const g = buildBloom()
    g?.start()
    return () => g?.stop()
  }, [tab, flowerReady, buildBloom])

  useEffect(() => {
    const g = tab === 'purge' ? buildPurge() : buildBloom()
    g?.resize?.()
    g?.render?.()
  }, [tab, buildPurge, buildBloom])

  useEffect(() => {
    const onResize = () => {
      purgeRef.current?.resize()
      bloomRef.current?.resize()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ---------- 摄像头 ----------
  const enableCamera = useCallback(async () => {
    if (camRef.current) return
    setCamStatus('loading')
    const { createCameraInput } = await import('./game/camera.js')
    const cam = await createCameraInput({
      video: videoRef.current,
      overlay: overlayRef.current,
      onValue: (v) => {
        if (!v.detected || !v.skeleton) {
          handRef.current = null
          setDetected(false)
          return
        }
        setDetected(true)
        // camera.js 给的是未镜像的归一化坐标，这里翻一次（画面是镜像的）
        const sk = v.skeleton.map((p) => ({ x: 1 - p.x, y: p.y }))
        const tip = sk[8]
        handRef.current = {
          detected: true,
          g: v.g,
          skeleton: sk,
          tipX: tip.x,
          tipY: tip.y,
        }
      },
      onStatus: (st) => setCamStatus(st),
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

  // 把输入喂给当前引擎（摄像头优先，没有就用鼠标/触摸当虚拟手指）
  useEffect(() => {
    let raf = null
    const tick = () => {
      const p = pointerRef.current
      const hand = handRef.current
      const useVirtual = (!hand || !detected) && p.seen
      const virtualHand = useVirtual
        ? {
            detected: true,
            g: p.down ? 0.1 : 0.9,
            skeleton: null,
            tipX: p.x,
            tipY: p.y,
          }
        : null
      const list = hand ? [hand] : virtualHand ? [virtualHand] : []

      purgeRef.current?.setHands(list)

      if (tabRef.current === 'bloom') {
        // 花朵看的是"张得多开"：真手直接用 g；鼠标回退用横向位置当开合度
        if (hand) bloomRef.current?.setOpenness(hand.g)
        else if (p.seen) bloomRef.current?.setOpenness(p.x)
        else bloomRef.current?.setOpenness(null)
      }
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

  const startPurge = () => {
    buildPurge()
    setResult(null)
    setPhase('playing')
    purgeRef.current?.start()
  }

  const stopPurge = () => {
    purgeRef.current?.stop()
    setPhase('ready')
    purgeRef.current?.render()
  }

  const switchTab = (k) => {
    if (k === tab) return
    purgeRef.current?.stop()
    bloomRef.current?.stop()
    setTab(k)
    if (k === 'purge') setPhase('ready')
  }

  const camOn = camStatus === 'ready'
  const playing = phase === 'playing'

  return (
    <div className={'sandbox sandbox--' + tab}>
      <header className="sandbox-bar">
        <button className="sandbox-icon" onClick={onExit} aria-label="返回首页">
          ‹
        </button>

        <div className="segmented">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={'seg' + (tab === t.key ? ' is-on' : '')}
              onClick={() => switchTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          className={'sandbox-cam' + (camOn ? ' is-on' : '')}
          onClick={enableCamera}
          disabled={camOn || camStatus === 'loading'}
        >
          {camOn ? (detected ? '已识别' : '举手对准') : CAM_TIPS[camStatus] || '开启摄像头'}
        </button>
      </header>

      {tab === 'purge' && (
        <>
          <div className="purge-hud">
            <div className="purge-stat">
              <span className="purge-label">
                <i className="purge-dot" /> Active targets
              </span>
              <b>{hud.active}</b>
            </div>
            <div className="purge-stat purge-stat--mid">
              <span className="purge-label">Time remaining</span>
              <b className={hud.time <= 10 ? 'is-low' : ''}>{mmss(hud.time)}</b>
            </div>
            <div className="purge-stat purge-stat--right">
              <span className="purge-label">Stress relieved</span>
              <b>{hud.score}</b>
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
            {hud.combo > 2 && playing && (
              <div className="purge-combo">连击 ×{hud.combo}</div>
            )}

            {phase === 'ready' && (
              <div className="sandbox-overlay">
                <div className="sandbox-card">
                  <span className="sandbox-eyebrow">Stress purge</span>
                  <h2>把气捏爆。</h2>
                  <p>
                    {camOn
                      ? '张开手，画面里的指尖就是你的指尖。捏合，碰球即爆。'
                      : '没开摄像头也能玩：按住鼠标当捏合。'}
                  </p>
                  <button className="btn btn--primary" onClick={startPurge}>
                    开始 60 秒
                  </button>
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
                    <button className="btn btn--primary" onClick={startPurge}>
                      再来一局
                    </button>
                    <button className="btn btn--ghost" onClick={stopPurge}>
                      返回
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="purge-foot">
            <span className="purge-chip">View: normal</span>
            <span className="purge-chip">{hud.combo > 0 ? 'Grip: hot' : 'Grip: armed'}</span>
            <span className="purge-hint">捏合指尖碰气球，空处拖拽平移视角</span>
          </div>
        </>
      )}

      {tab === 'bloom' && (
        <>
          <div className="bloom-stage">
            <canvas
              ref={bloomCanvas}
              className="bloom-canvas"
              onPointerMove={(e) => setPointer(e)}
              onPointerDown={(e) => setPointer(e, true)}
              onPointerUp={(e) => setPointer(e, false)}
              onPointerLeave={(e) => setPointer(e, false)}
            />
            {!flowerReady && <div className="bloom-loading">正在展开花瓣…</div>}

            {bloomIntro && (
              <div className="bloom-intro">
                <div className="sandbox-card">
                  <span className="sandbox-eyebrow">Bloom</span>
                  <h2>张开手，花就开。</h2>
                  <p>
                    手张开多少，花就开到多少；握拳，它收成花苞。开满停一会儿，会换下一朵。
                  </p>
                  <p className="sandbox-sub">
                    {camStatus === 'ready'
                      ? '把整只手放进画面，离镜头 40–60cm。'
                      : '没开摄像头也行：在画面上左右拖动。'}
                  </p>
                  <button className="btn btn--primary" onClick={closeBloomIntro}>
                    试试
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bloom-foot">
            <div className="bloom-title">
              <span className="bloom-brand">In Full · Bloom</span>
              <span className="bloom-sub">
                {FLOWERS[bhud.index]?.cn} · {Math.round(bhud.bloom * 100)}% 绽放
              </span>
            </div>
            <span className="bloom-hint">
              {camOn ? '张开手，花就开；握拳，收回花苞' : '横向拖动，或开启摄像头用手控制'}
            </span>
          </div>

          <div className="bloom-credit">
            花开素材取自参考原型（从录屏逆向提取的序列帧）
          </div>
        </>
      )}

      {/* 摄像头元素常驻，切页不重建，否则流会断 */}
      <div
        className={
          'cam-box' + (tab === 'bloom' && camStatus === 'ready' ? ' is-peek' : ' is-hidden')
        }
      >
        <video ref={videoRef} className="cam-video" playsInline muted />
        <canvas ref={overlayRef} className="cam-overlay" width={240} height={180} />
      </div>
    </div>
  )
}
