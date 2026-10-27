/**
 * 捏爆音效 · WebAudio 现场合成
 *
 * 不引任何音频文件：气球爆掉的声音本质是「一段快速衰减的宽带噪声
 * + 一记下滑的低频撞击」，用噪声 buffer + 带通扫频 + 正弦下扫就能合成，
 * 而且能随机音高，连爆的时候不会听出"同一段采样在重复"。
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export function createSfx() {
  let ctx = null
  let noise = null
  let muted = false
  let lastPlay = 0

  /** 必须在用户手势里调用一次，否则浏览器不让出声 */
  function ensure() {
    if (ctx) return ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()

    // 0.3s 白噪声，复用
    const len = Math.floor(ctx.sampleRate * 0.3)
    noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    return ctx
  }

  /**
   * @param {number} depth 0..1，越近越响（用气球深度算）
   * @param {number} combo 连击数，用来做音高递升
   */
  function pop(depth = 0.5, combo = 0) {
    if (muted) return
    const ac = ensure()
    if (!ac) return
    if (ac.state === 'suspended') ac.resume()

    const now = ac.currentTime
    // 同帧内多次触发会叠成噪音，掐一下最小间隔
    if (now - lastPlay < 0.012) return
    lastPlay = now

    const vol = clamp(0.16 + depth * 0.34, 0.1, 0.5)
    // 连击越高，音高越亮，最多上浮 4 个半音
    const shift = Math.pow(2, Math.min(combo, 8) / 24)

    // 1) 噪声爆裂：带通从 1600Hz 扫到 420Hz
    const src = ac.createBufferSource()
    src.buffer = noise
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.1
    bp.frequency.setValueAtTime(1600 * shift, now)
    bp.frequency.exponentialRampToValueAtTime(420, now + 0.14)

    const g1 = ac.createGain()
    g1.gain.setValueAtTime(0.0001, now)
    g1.gain.exponentialRampToValueAtTime(vol, now + 0.004)
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.19)

    src.connect(bp).connect(g1).connect(ac.destination)
    src.start(now)
    src.stop(now + 0.22)

    // 2) 低频"砰"：正弦从 180Hz 掉到 62Hz
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(180 * shift, now)
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.1)

    const g2 = ac.createGain()
    g2.gain.setValueAtTime(0.0001, now)
    g2.gain.exponentialRampToValueAtTime(vol * 0.75, now + 0.006)
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.13)

    osc.connect(g2).connect(ac.destination)
    osc.start(now)
    osc.stop(now + 0.15)
  }

  /** 气球被捏住时的闷响，很轻 */
  function squish() {
    if (muted) return
    const ac = ensure()
    if (!ac || ac.state === 'suspended') return
    const now = ac.currentTime
    const src = ac.createBufferSource()
    src.buffer = noise
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(520, now)
    lp.frequency.exponentialRampToValueAtTime(180, now + 0.16)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.05, now + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
    src.connect(lp).connect(g).connect(ac.destination)
    src.start(now)
    src.stop(now + 0.2)
  }

  // ---------------- 抓取挑战用 ----------------

  /** 短音，用来拼各种"叮" */
  function tone({ f0, f1, dur = 0.12, vol = 0.12, type = 'sine', delay = 0 }) {
    const ac = ctx
    const now = ac.currentTime + delay
    const osc = ac.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(f0, now)
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, now + dur)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(vol, now + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    osc.connect(g).connect(ac.destination)
    osc.start(now)
    osc.stop(now + dur + 0.02)
  }

  /** 噪声段，用来拼"裂/擦" */
  function hiss({ f0 = 1600, f1 = 420, dur = 0.18, vol = 0.2, q = 1.1, delay = 0 }) {
    const ac = ctx
    const now = ac.currentTime + delay
    const src = ac.createBufferSource()
    src.buffer = noise
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = q
    bp.frequency.setValueAtTime(f0, now)
    bp.frequency.exponentialRampToValueAtTime(f1, now + dur)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(vol, now + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    src.connect(bp).connect(g).connect(ac.destination)
    src.start(now)
    src.stop(now + dur + 0.02)
  }

  function ready() {
    if (muted) return null
    const ac = ensure()
    if (!ac) return null
    if (ac.state === 'suspended') ac.resume()
    return ac
  }

  /** 抓住了：一记短促上扬的"叮"，连击越高越亮 */
  function grab(combo = 0, perfect = false) {
    if (!ready()) return
    const shift = Math.pow(2, Math.min(combo, 12) / 26)
    if (perfect) {
      tone({ f0: 880 * shift, f1: 1320 * shift, dur: 0.11, vol: 0.14 })
      tone({ f0: 1320 * shift, f1: 1760 * shift, dur: 0.16, vol: 0.1, delay: 0.06 })
    } else {
      tone({ f0: 520 * shift, f1: 760 * shift, dur: 0.08, vol: 0.11 })
    }
    hiss({ f0: 2600, f1: 1400, dur: 0.045, vol: 0.05, q: 2 })
  }

  /** 捏碎了：裂声 + 一记闷响（坏消息，故意做得糙一点） */
  function crack() {
    if (!ready()) return
    hiss({ f0: 1400, f1: 260, dur: 0.22, vol: 0.24, q: 0.8 })
    tone({ f0: 110, f1: 48, dur: 0.16, vol: 0.16, type: 'triangle' })
  }

  /** 漏了：一声很闷的下坠 */
  function drop() {
    if (!ready()) return
    tone({ f0: 190, f1: 90, dur: 0.15, vol: 0.1, type: 'sine' })
  }

  // ---------------- 抓取挑战用 ----------------

  /** 短音，用来拼各种"叮" */
  function tone({ f0, f1, dur = 0.12, vol = 0.12, type = 'sine', delay = 0 }) {
    const ac = ctx
    const now = ac.currentTime + delay
    const osc = ac.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(f0, now)
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, now + dur)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(vol, now + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    osc.connect(g).connect(ac.destination)
    osc.start(now)
    osc.stop(now + dur + 0.02)
  }

  /** 噪声段，用来拼"裂/擦" */
  function hiss({ f0 = 1600, f1 = 420, dur = 0.18, vol = 0.2, q = 1.1, delay = 0 }) {
    const ac = ctx
    const now = ac.currentTime + delay
    const src = ac.createBufferSource()
    src.buffer = noise
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = q
    bp.frequency.setValueAtTime(f0, now)
    bp.frequency.exponentialRampToValueAtTime(f1, now + dur)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(vol, now + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    src.connect(bp).connect(g).connect(ac.destination)
    src.start(now)
    src.stop(now + dur + 0.02)
  }

  function ready() {
    if (muted) return null
    const ac = ensure()
    if (!ac) return null
    if (ac.state === 'suspended') ac.resume()
    return ac
  }

  /** 抓住了：一记短促上扬的"叮"，连击越高越亮 */
  function grab(combo = 0, perfect = false) {
    if (!ready()) return
    const shift = Math.pow(2, Math.min(combo, 12) / 26)
    if (perfect) {
      tone({ f0: 880 * shift, f1: 1320 * shift, dur: 0.11, vol: 0.14 })
      tone({ f0: 1320 * shift, f1: 1760 * shift, dur: 0.16, vol: 0.1, delay: 0.06 })
    } else {
      tone({ f0: 520 * shift, f1: 760 * shift, dur: 0.08, vol: 0.11 })
    }
    hiss({ f0: 2600, f1: 1400, dur: 0.045, vol: 0.05, q: 2 })
  }

  /** 捏碎了：裂声 + 一记闷响（坏消息，故意做得糙一点） */
  function crack() {
    if (!ready()) return
    hiss({ f0: 1400, f1: 260, dur: 0.22, vol: 0.24, q: 0.8 })
    tone({ f0: 110, f1: 48, dur: 0.16, vol: 0.16, type: 'triangle' })
  }

  /** 漏了：一声很闷的下坠 */
  function drop() {
    if (!ready()) return
    tone({ f0: 190, f1: 90, dur: 0.15, vol: 0.1, type: 'sine' })
  }

  function setMuted(v) {
    muted = v
  }

  return { pop, squish, grab, crack, drop, ensure, setMuted, isMuted: () => muted }
}
