/**
 * 视频拆帧（开发用）——本机没有 ffmpeg，改用 Chrome 解码 + Canvas 拼图
 *
 * 用法：node tools/vidframes.mjs <视频绝对路径> <输出png> [帧数] [列数] [帧宽] [起] [止]
 * 例：  node tools/vidframes.mjs "C:/Users/16101/Videos/屏幕录制/手势交互1.mp4" shots/frames.png 24 4
 *       node tools/vidframes.mjs "...mp4" shots/a.png 12 3 520 0 34
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const [, , file, out, nArg, colArg, wArg, sArg, eArg] = process.argv
const N = Number(nArg || 24)
const COLS = Number(colArg || 4)
const W = Number(wArg || 320)
const T0 = sArg === undefined ? null : Number(sArg)
const T1 = eArg === undefined ? null : Number(eArg)

if (!file || !out) {
  console.error('用法: node tools/vidframes.mjs <视频> <输出png> [帧数] [列数]')
  process.exit(1)
}

const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '')
const videoUrl = toUrl(await fs.realpath(file))

const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#111}canvas{display:block}</style>
<video id="v" muted playsinline preload="auto"></video>
<canvas id="c"></canvas>
<script>
window.grab = async (N, COLS, W, T0, T1) => {
  const v = document.getElementById('v')
  await new Promise((res, rej) => {
    v.onloadedmetadata = res
    v.onerror = () => rej(new Error('video load failed'))
    v.src = ${JSON.stringify(videoUrl)}
    v.load()
  })
  const dur = v.duration
  const start = T0 == null ? 0 : T0
  const end = T1 == null ? dur : Math.min(T1, dur)
  const H = Math.round(W * v.videoHeight / v.videoWidth)
  const rows = Math.ceil(N / COLS)
  const c = document.getElementById('c')
  c.width = COLS * W
  c.height = rows * H
  const ctx = c.getContext('2d')
  for (let i = 0; i < N; i++) {
    const t = start + (end - start) * ((i + 0.5) / N)
    v.currentTime = t
    await new Promise((res) => { v.onseeked = res })
    // 单帧提取时 seeked 会早于画面真正上屏，等一下再画，否则拿到黑帧
    await new Promise((res) => setTimeout(res, 140))
    const x = (i % COLS) * W
    const y = Math.floor(i / COLS) * H
    ctx.drawImage(v, x, y, W, H)
    ctx.fillStyle = 'rgba(0,0,0,.7)'
    ctx.fillRect(x, y, 64, 20)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 13px monospace'
    ctx.fillText(t.toFixed(1) + 's', x + 5, y + 14)
  }
  return { dur, W, H, rows, range: [start, end] }
}
</script>`

const tmp = './.tmp-assets/_vid.html'
await fs.mkdir('./.tmp-assets', { recursive: true })
await fs.writeFile(tmp, html)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-first-run', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))

const abs = await fs.realpath(tmp)
await page.goto(toUrl(abs), { waitUntil: 'load', timeout: 20000 })
await page.waitForFunction('typeof window.grab === "function"', { timeout: 10000 })

const info = await page.evaluate(
  (n, c, w, t0, t1) => window.grab(n, c, w, t0, t1),
  N,
  COLS,
  W,
  T0,
  T1,
)
console.log(
  '时长 %ss  取 %s~%ss  %dx%d  帧数 %d',
  info.dur.toFixed(2),
  info.range[0].toFixed(1),
  info.range[1].toFixed(1),
  info.W,
  info.H,
  N,
)

const el = await page.$('#c')
await el.screenshot({ path: out })
console.log('saved', out)
await browser.close()
