import { useEffect, useRef, useState, useCallback } from 'react'
import { drawHand } from './hand.js'
import { createGame } from './game/engine.js'
import CalibDemo from './CalibDemo.jsx'

/** 评级按「每分钟得分」算，否则 120 秒局永远碾压 30 秒局 */
const RANKS = [
  { min: 2000, name: '灵巧手', en: 'DEXTEROUS' },
  { min: 1400, name: '黄金手指', en: 'GOLD FINGERS' },
  { min: 900, name: '白银手指', en: 'SILVER' },
  { min: 500, name: '青铜手指', en: 'BRONZE' },
  { min: 0, name: '新手', en: 'ROOKIE' },
]

const rateOf = (score, duration) => (duration > 0 ? (score / duration) * 60 : 0)
const rankOf = (rate) => RANKS.find((r) => rate >= r.min) || RANKS[RANKS.length - 1]

const DURATIONS = [30, 60, 90, 120]

const EMPTY_HUD = {
  score: 0,
  combo: 0,
  time: 90,
  misses: 0,
  caught: 0,
  g: 1,
  thumb: 0.5,
  target: null,
}

const bestKey = (d) => `grasp.best.${d}`
const readBest = (d) => Number(localStorage.getItem(bestKey(d)) || 0)

const CAM_TIPS = {
  idle: '摄像头未启动',
  loading: '正在加载识别引擎…',
  permission: '等待摄像头授权…',
  ready: '识别就绪',
  error: '摄像头启动失败，已切回滑轨',
}

export default function Game({ onExit }) {
  const canvasRef = useRef(null)
  const gameRef = useRef(null)
  const trackRef = useRef(null)
  const thumbRef = useRef(null)
  const videoRef = useRef(null)
  const overlayRef = useRef(null)
  const camRef = useRef(null)

  const [duration, setDuration] = useState(90)
  const [mode, setMode] = useState('slider')
  const [hud, setHud] = useState(EMPTY_HUD)
  const [phase, setPhase] = useState('setup')
  const [count, setCount] = useState(3)
  const [result, setResult] = useState(null)
  const [best, setBest] = useState(() => readBest(90))

  const [camStatus, setCamStatus] = useState('idle')
  const [detected, setDetected] = useState(false)
  const [calibStep, setCalibStep] = useState(null)
  const [calibMsg, setCalibMsg] = useState('')

  const modeRef = useRef(mode)
  modeRef.current = mode

  // ---------- 构造 / 重建引擎 ----------
  const build = useCallback((dur, m) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    gameRef.current?.stop()
    const game = createGame({
      canvas,
      duration: dur,
      mode: m,
      videoEl: videoRef.current,
      onHud: setHud,
      onEnd: (r) => {
        setPhase('end')
        setResult(r)
        const prev = readBest(dur)
        if (r.score > prev) localStorage.setItem(bestKey(dur), String(r.score))
        setBest(Math.max(prev, r.score))
      },
    })
    game.setHandRenderer((ctx, x, y, g, t) => drawHand(ctx, { x, y, g, t, scale: 1.2 }))
    gameRef.current = game
    window.__game = game // 调试用
    game.render()
    return game
  }, [])

  useEffect(() => {
    build(duration, mode)
    const onResize = () => {
      const g = gameRef.current
      if (!g) return
      g.resize()
      if (g.getState().t === 0) g.render()
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      gameRef.current?.stop()
      gameRef.current = null
      camRef.current?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 摄像头模式 ----------
  const enableCamera = useCallback(async () => {
    if (camRef.current) return
    setMode('camera')
    setCamStatus('loading')
    build(duration, 'camera')
    const { createCameraInput } = await import('./game/camera.js')
    const cam = await createCameraInput({
      video: videoRef.current,
      overlay: overlayRef.current,
      onValue: (v) => {
        if (!v.detected) {
          setDetected(false)
          return
        }
        setDetected(true)
        gameRef.current?.setAperture(v.g)
        if (v.nx != null) gameRef.current?.setHandNorm(v.nx, v.ny, v.skeleton)
      },
      onStatus: (s) => setCamStatus(s),
    })
    camRef.current = cam
    const ok = await cam.start()
    if (!ok) {
      camRef.current = null
      setMode('slider')
      build(duration, 'slider')
    }
  }, [build, duration])

  const disableCamera = useCallback(() => {
    camRef.current?.stop()
    camRef.current = null
    setMode('slider')
    setCamStatus('idle')
    setCalibStep(null)
    setCalibMsg('')
    build(duration, 'slider')
  }, [build, duration])

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  const runCalibration = async () => {
    const cam = camRef.current
    if (!cam) return
    setCalibStep('open')
    setCalibMsg('')
    await sleep(400)
    cam.beginCalibration()
    await sleep(2800)
    setCalibStep('fist')
    await sleep(2800)
    const res = cam.endCalibration()
    setCalibStep('done')
    setCalibMsg(
      res.ok
        ? `校准完成 ${res.lo.toFixed(2)} → ${res.hi.toFixed(2)}`
        : '动作幅度太小，沿用默认范围'
    )
    await sleep(1600)
    setCalibStep(null)
  }

  // ---------- 倒计时 ----------
  useEffect(() => {
    if (phase !== 'count') return
    let n = 3
    setCount(3)
    const id = setInterval(() => {
      n -= 1
      if (n <= 0) {
        clearInterval(id)
        setPhase('play')
        gameRef.current?.start()
      } else {
        setCount(n)
      }
    }, 700)
    return () => clearInterval(id)
  }, [phase])

  // ---------- 键盘 ----------
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onExit()
        return
      }
      const g = gameRef.current
      if (!g || phase !== 'play' || modeRef.current === 'camera') return
      const s = g.getState()
      if (e.key === 'ArrowLeft' || e.key === 'a') g.setAperture(s.g - 0.03)
      if (e.key === 'ArrowRight' || e.key === 'd') g.setAperture(s.g + 0.03)
      if (e.key === 'ArrowUp' || e.key === 'w') g.setThumb(s.thumb + 0.06)
      if (e.key === 'ArrowDown' || e.key === 's') g.setThumb(s.thumb - 0.06)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onExit])

  // ---------- 拖拽输入 ----------
  const bindDrag = useCallback((ref, apply) => {
    const el = ref.current
    if (!el) return () => {}
    const set = (clientX) => {
      const r = el.getBoundingClientRect()
      apply(Math.max(0, Math.min(1, (clientX - r.left) / r.width)))
    }
    const down = (e) => {
      if (modeRef.current === 'camera') return
      el.setPointerCapture?.(e.pointerId)
      set(e.clientX)
      const move = (ev) => set(ev.clientX)
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    }
    el.addEventListener('pointerdown', down)
    return () => el.removeEventListener('pointerdown', down)
  }, [])

  useEffect(() => {
    const c1 = bindDrag(trackRef, (v) => gameRef.current?.setAperture(v))
    const c2 = bindDrag(thumbRef, (v) => gameRef.current?.setThumb(v))
    return () => {
      c1()
      c2()
    }
  }, [bindDrag])

  const startGame = (dur = duration) => {
    setDuration(dur)
    setBest(readBest(dur))
    setResult(null)
    setHud({ ...EMPTY_HUD, time: dur })
    build(dur, mode)
    setPhase('count')
  }

  const target = hud.target
  const bandLeft = target ? Math.max(0, target.gOpt - target.tol) * 100 : 0
  const bandWidth = target ? Math.min(100, target.tol * 2 * 100) : 0
  const timeLow = hud.time <= 10
  const camOn = mode === 'camera'

  return (
    <div className="game">
      <header className="game-hud">
        <button className="game-back" onClick={onExit} aria-label="返回">
          ←
        </button>
        <div className="hud-score">
          <span className="hud-label">SCORE</span>
          <b className="hud-value">{hud.score}</b>
        </div>
        <div className="hud-mid">
          {camOn && (
            <span className={'hud-cam' + (detected ? ' is-on' : '')}>
              <i />
              {detected ? 'CAM' : 'NO HAND'}
            </span>
          )}
          {hud.combo > 1 && <span className="hud-combo">×{hud.combo}</span>}
          <span className={'hud-time' + (timeLow ? ' is-low' : '')}>{Math.ceil(hud.time)}s</span>
        </div>
        <div className="hud-lives" aria-label={'失误 ' + hud.misses}>
          {[0, 1, 2].map((i) => (
            <i key={i} className={i < 3 - hud.misses ? 'life' : 'life off'} />
          ))}
        </div>
      </header>

      <div className="stage-wrap">
        <canvas ref={canvasRef} className="stage-canvas" />

        {/* 摄像头预览：只在摄像头模式显示 */}
        <div className={'cam-preview' + (camOn && phase !== 'play' ? ' is-on' : '')}>
          <video ref={videoRef} playsInline muted autoPlay />
          <canvas ref={overlayRef} />
          {camOn && camStatus === 'ready' && !detected && <span>没检测到手</span>}
        </div>

        {phase === 'setup' && (
          <div className="setup-overlay">
            <div className="setup-card">
              <span className="setup-eyebrow">DEXTEROUS GRASP</span>
              <h2 className="setup-title">选择操作方式</h2>

              <div className="duration-row">
                <button
                  className={'duration-pill' + (!camOn ? ' is-on' : '')}
                  onClick={disableCamera}
                >
                  滑轨
                </button>
                <button
                  className={'duration-pill' + (camOn ? ' is-on' : '')}
                  onClick={enableCamera}
                >
                  摄像头
                </button>
              </div>

              {camOn ? (
                <div className="cam-panel">
                  <p className="setup-hint">
                    {CAM_TIPS[camStatus] || camStatus}
                    {calibMsg ? ' · ' + calibMsg : ''}
                  </p>
                  {camStatus === 'ready' && (
                    <button
                      className="cam-calib-btn"
                      onClick={runCalibration}
                      disabled={!!calibStep}
                    >
                      {calibStep ? (calibStep === 'open' ? '张开手掌…' : '握拳…') : '校准手型'}
                    </button>
                  )}
                </div>
              ) : (
                <p className="setup-hint">
                  看物体外围的虚线框，把底部开口调到那个宽度，停在抓取区里保持一瞬。
                  鸡蛋和玻璃杯经不起猛合。
                </p>
              )}

              <h2 className="setup-title setup-title--sub">选择一局时长</h2>
              <div className="duration-row">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    className={'duration-pill' + (d === duration ? ' is-on' : '')}
                    onClick={() => {
                      setDuration(d)
                      setBest(readBest(d))
                      build(d, mode)
                    }}
                  >
                    {d}s
                  </button>
                ))}
              </div>

              <div className="setup-actions">
                <button
                  className="btn btn--primary"
                  onClick={() => startGame()}
                  disabled={(camOn && camStatus !== 'ready') || !!calibStep}
                >
                  开始
                </button>
                {best > 0 && <span className="setup-best">最高 {best}</span>}
              </div>
            </div>
          </div>
        )}

        {calibStep && (
          <div className="calib-overlay">
            <div className="calib-card">
              <span className="setup-eyebrow">校准手型</span>

              {calibStep === 'done' ? (
                <div className="calib-done">✓</div>
              ) : (
                <CalibDemo step={calibStep === 'fist' ? 'fist' : 'open'} />
              )}

              <h3 className="calib-title">
                {calibStep === 'open' && '① 手掌完全张开'}
                {calibStep === 'fist' && '② 握紧拳头'}
                {calibStep === 'done' && '校准完成'}
              </h3>

              <p className="setup-hint">
                {calibStep === 'done'
                  ? calibMsg
                  : '跟着上面的手做，保持不要动 · 离镜头 40–60cm'}
              </p>

              {calibStep !== 'done' && (
                <>
                  <span className={'calib-live' + (detected ? ' is-on' : '')}>
                    <i /> {detected ? '已识别到你的手' : '没看到手，调整一下位置'}
                  </span>
                  <div className="calib-bar">
                    <i key={calibStep} />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {phase === 'count' && (
          <div className="count-overlay">
            <b>{count}</b>
            <span>{camOn ? '抬起手，对准镜头' : '对准 → 保持 → 夹住'}</span>
          </div>
        )}

        {phase === 'end' && result && (
          <div className="result-overlay">
            <div className="result-card">
              <span className="result-rank">{rankOf(rateOf(result.score, duration)).en}</span>
              <b className="result-score">{result.score}</b>
              <span className="result-sub">
                {rankOf(rateOf(result.score, duration)).name} · {duration}s 局 ·{' '}
                {Math.round(rateOf(result.score, duration))} 分/分钟 · 最高 {best}
              </span>

              <div className="result-grid">
                <div>
                  <span>抓取</span>
                  <b>{result.caught}</b>
                </div>
                <div>
                  <span>完美</span>
                  <b>{result.perfects}</b>
                </div>
                <div>
                  <span>最高连击</span>
                  <b>{result.maxCombo}</b>
                </div>
                <div>
                  <span>成功率</span>
                  <b>{Math.round(result.rate * 100)}%</b>
                </div>
              </div>

              <div className="result-actions">
                <button className="btn btn--primary" onClick={() => startGame()}>
                  再来一局
                </button>
                <button className="btn btn--ghost" onClick={() => setPhase('setup')}>
                  换设置
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="controls">
        <div className="ctrl-row">
          <span className="ctrl-label">开合</span>
          <div className={'track' + (camOn ? ' is-locked' : '')} ref={trackRef}>
            <div className="track-fill" style={{ width: hud.g * 100 + '%' }} />
            {target && phase === 'play' && (
              <div
                className="track-target"
                style={{ left: bandLeft + '%', width: bandWidth + '%' }}
              />
            )}
            <div className="track-knob" style={{ left: hud.g * 100 + '%' }} />
          </div>
          <span className="ctrl-hint">{camOn ? '手势' : target ? target.name : '—'}</span>
        </div>

        {!camOn && (
          <div className="ctrl-row ctrl-row--thumb">
            <span className="ctrl-label">拇指</span>
            <div className="track track--sm" ref={thumbRef}>
              <div className="track-fill" style={{ width: hud.thumb * 100 + '%' }} />
              <div className="track-knob" style={{ left: hud.thumb * 100 + '%' }} />
            </div>
            <span className="ctrl-hint">微调</span>
          </div>
        )}
      </div>
    </div>
  )
}
