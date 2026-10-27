/**
 * 摄像头手部输入
 * MediaPipe Hand Landmarker（本地 WASM + 本地模型），输出开合度 g 与拇指轴 t。
 *
 * 关键处理：
 * 1. 关键点坐标是按画面宽高归一化的，x/y 尺度不同 → 先乘回像素尺寸再算距离
 * 2. 开合度 = 拇指尖-食指尖 ÷ 掌宽（尺度无关），再用标定区间映射到 0..1
 * 3. One Euro 滤波：静止时强平滑、快速动作低延迟（固定 EMA 做不到）
 */

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]

const alphaOf = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt)

/** One Euro filter */
function makeOneEuro({ minCutoff = 1.2, beta = 0.02, dCutoff = 1.0 } = {}) {
  let xPrev = null
  let dxPrev = 0
  let tPrev = 0
  return (x, t) => {
    const dt = tPrev ? Math.max(1e-3, (t - tPrev) / 1000) : 1 / 60
    const dx = xPrev === null ? 0 : (x - xPrev) / dt
    const aD = alphaOf(dCutoff, dt)
    dxPrev = dxPrev + aD * (dx - dxPrev)
    const cutoff = minCutoff + beta * Math.abs(dxPrev)
    const a = alphaOf(cutoff, dt)
    const out = xPrev === null ? x : xPrev + a * (x - xPrev)
    xPrev = out
    tPrev = t
    return out
  }
}

/**
 * 加载 MediaPipe 的 ESM bundle
 * 它放在 public/ 下，不能被 Vite 的模块图 import（会报 500），
 * 所以取回源码后用 Blob URL 动态导入，保持零打包、可懒加载。
 */
let visionModule = null
async function loadVision() {
  if (visionModule) return visionModule
  const src = await fetch('/mp/vision_bundle.mjs').then((r) => {
    if (!r.ok) throw new Error('无法加载识别引擎 ' + r.status)
    return r.text()
  })
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
  try {
    visionModule = await import(/* @vite-ignore */ url)
  } finally {
    URL.revokeObjectURL(url)
  }
  return visionModule
}

export async function createCameraInput({ video, overlay, onValue, onStatus }) {
  let landmarker = null
  const state = { stream: null }
  let raf = null
  let running = false
  let lastVideoTime = -1

  // 用户实测标定：0.17（握拳）→ 2.09（张开）
  let lo = 0.17
  let hi = 2.09
  let calibrating = false
  let calMin = Infinity
  let calMax = -Infinity

  const smoothG = makeOneEuro()
  const smoothT = makeOneEuro({ minCutoff: 2.0, beta: 0.03 })

  const setStatus = (s, extra) => onStatus?.(s, extra)

  async function initModel() {
    setStatus('loading')
    const { FilesetResolver, HandLandmarker } = await loadVision()
    const fileset = await FilesetResolver.forVisionTasks('/mp/wasm')
    landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
  }

  /** 视频播放重试：元素可能刚插入 DOM 或还不可见 */
  async function tryPlay(el, tries = 8) {
    for (let i = 0; i < tries; i++) {
      try {
        await el.play()
        return true
      } catch (e) {
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    return false
  }

  async function start() {
    let stream = null
    try {
      if (!landmarker) await initModel()

      setStatus('permission')
      // 先释放可能存在的旧流，避免同一页面重复启动时被占用
      if (state.stream) {
        state.stream.getTracks().forEach((t) => t.stop())
        state.stream = null
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      })
      state.stream = stream

      video.srcObject = stream
      // play() 失败**不代表启动失败**：流已经拿到了（指示灯会亮），
      // 常见原因是 <video> 当时还不可见（display:none）或处于隐藏面板里。
      // 所以重试几次，最坏情况也只是画面稍后开始，不影响识别链路。
      const started = await tryPlay(video)
      if (!started) console.warn('[camera] video 未能自动播放，画面可能不刷新')

      if (overlay) {
        overlay.width = 240
        overlay.height = 180
      }
      running = true
      setStatus('ready')
      loop()
      return true
    } catch (e) {
      // 失败时把已经拿到的流放掉，别一直占着摄像头
      if (stream) stream.getTracks().forEach((t) => t.stop())
      const name = e?.name || 'Error'
      const msg = e?.message || String(e)
      const readable =
        name === 'NotReadableError' || name === 'TrackStartError'
          ? '摄像头被其他页面占用（比如另一个标签页还开着摄像头模式），关掉它再试'
          : name === 'NotAllowedError'
          ? '摄像头权限被拒绝，请在地址栏左侧的图标里重新允许'
          : name === 'NotFoundError'
          ? '没有找到摄像头设备'
          : msg
      setStatus('error', `${readable}（${name}）`)
      return false
    }
  }

  function loop() {
    if (!running) return
    if (video.currentTime !== lastVideoTime && landmarker) {
      lastVideoTime = video.currentTime
      try {
        const t0 = performance.now()
        const res = landmarker.detectForVideo(video, performance.now())
        inferMs = performance.now() - t0
        handle(res)
      } catch (e) {
        // 单帧处理出错绝不能中断整个识别循环，否则手一出现就"识别一秒后消失"
        console.error('[camera] 单帧处理异常', e)
      }
    }
    raf = requestAnimationFrame(loop)
  }

  const octx = overlay ? overlay.getContext('2d') : null

  let fps = 0
  let frameCount = 0
  let fpsT0 = performance.now()
  let inferMs = 0

  /** 预览窗里的小骨架（镜像绘制，与镜像后的视频对齐） */
  function previewSkeleton(pts, w, h) {
    octx.strokeStyle = 'rgba(255,255,255,0.55)'
    octx.lineWidth = 1
    for (const [a, b] of CONNECTIONS) {
      octx.beginPath()
      octx.moveTo(w - pts[a].x, pts[a].y)
      octx.lineTo(w - pts[b].x, pts[b].y)
      octx.stroke()
    }
  }

  function handle(res) {
    const w = overlay ? overlay.width : 0
    const h = overlay ? overlay.height : 0
    if (octx) octx.clearRect(0, 0, w, h)

    frameCount++
    const nowMs = performance.now()
    if (nowMs - fpsT0 > 500) {
      fps = Math.round((frameCount * 1000) / (nowMs - fpsT0))
      frameCount = 0
      fpsT0 = nowMs
    }

    if (!res.landmarks || res.landmarks.length === 0 || (res.landmarks[0]?.length || 0) < 21) {
      onValue?.({ detected: false, fps, ms: inferMs })
      return
    }

    if (octx) {
      previewSkeleton(
        res.landmarks[0].map((p) => ({ x: p.x * w, y: p.y * h })),
        w,
        h
      )
    }

    const lm = res.landmarks[0]
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
    const palmW = dist(lm[5], lm[17])
    const span = dist(lm[4], lm[8])
    const ratio = palmW > 0.001 ? span / palmW : 0

    if (calibrating) {
      calMin = Math.min(calMin, ratio)
      calMax = Math.max(calMax, ratio)
    }

    const raw = Math.min(1, Math.max(0, (ratio - lo) / (hi - lo)))
    const now = performance.now()
    const g = smoothG(raw, now)

    // 拇指独立轴：2-3-4 夹角，越小越弯
    const a1 = Math.atan2(lm[2].y - lm[3].y, lm[2].x - lm[3].x)
    const a2 = Math.atan2(lm[4].y - lm[3].y, lm[4].x - lm[3].x)
    let ang = Math.abs(a1 - a2)
    if (ang > Math.PI) ang = Math.PI * 2 - ang
    const t = smoothT(Math.min(1, Math.max(0, 1 - ang / Math.PI)), now)

    // 这里给的是**原始未镜像**的归一化坐标。
    // 镜像发生在画布绘制视频的时候（translate+scale(-1,1)），
    // 换算只做一次，否则会镜像两次、骨架和真手左右相反。
    const palm = lm[9]
    const skeleton = lm.map((p) => ({ x: p.x, y: p.y }))
    onValue?.({ detected: true, g, t, ratio, nx: palm.x, ny: palm.y, skeleton, fps, ms: inferMs })
  }

  function beginCalibration() {
    calibrating = true
    calMin = Infinity
    calMax = -Infinity
  }

  function endCalibration() {
    calibrating = false
    if (calMax > calMin + 0.3) {
      lo = calMin
      hi = calMax
      return { ok: true, lo, hi }
    }
    return { ok: false, lo, hi }
  }

  function stop() {
    running = false
    if (raf) cancelAnimationFrame(raf)
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop())
    state.stream = null
    if (video) video.srcObject = null
    setStatus('idle')
  }

  return { start, stop, beginCalibration, endCalibration, getRange: () => ({ lo, hi }) }
}
