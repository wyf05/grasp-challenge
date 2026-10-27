/**
 * 抠像抽帧（开发用）：把绿背景的花开延时视频抠成透明底序列帧
 *
 * 思路：花瓣是橙/粉（R 高、G 低），叶子是绿（G 最高）。
 * 用 "greenness = G - max(R,B)" 当透明度依据，比 HSV 色相分割更稳，
 * 暗部（阴影里的叶子）也能一起清掉；再用连通域只保留画面中心那一朵，
 * 边缘的另一朵花、杂物整块丢掉。
 *
 * 缩放一致性：每帧按各自抠像包围盒居中，但裁切尺寸取全序列最大值，
 * 这样"花从小长大"的关系被保留下来，不会每帧都顶满画面。
 *
 * 用法：node tools/keyframes.mjs <video> <outDir> [帧数] [目标高度]
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const [, , file, outDir, nArg, hArg, shyArg] = process.argv
const N = Number(nArg || 22)
const OUT_H = Number(hArg || 620)
// 裁切窗口向上偏移（占边长的比例）：花在原视频里偏下，茎很长，往上是头
const SHY = Number(shyArg || 0)

const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '')
const videoUrl = toUrl(await fs.realpath(file))

const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#fff}canvas{display:block}</style>
<video id="v" muted playsinline preload="auto"></video>
<canvas id="c"></canvas>
<script>
const v = document.getElementById('v')

function keyFrame(w, h, soft = 26) {
  const src = document.createElement('canvas')
  src.width = w; src.height = h
  const sx = src.getContext('2d', { willReadFrequently: true })
  sx.drawImage(v, 0, 0, w, h)
  const img = sx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    const green = g - Math.max(r, b)
    let a = 1 - Math.max(0, green) / soft
    if (a < 0) a = 0
    if (a > 1) a = 1
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    const sat = mx === 0 ? 0 : (mx - mn) / mx
    if (lum < 0.34 || (sat < 0.16 && lum < 0.62)) a = 0
    if (green > 0 && a > 0) d[i + 1] = Math.round(Math.min(g, (r + b) / 2 + 6))
    d[i + 3] = Math.round(a * 255)
  }
  sx.putImageData(img, 0, 0)
  return src
}

function keepCenterBlob(src) {
  const w = src.width, h = src.height
  const ctx = src.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const S = 4
  const mw = Math.ceil(w / S), mh = Math.ceil(h / S)
  const mask = new Uint8Array(mw * mh)
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      let hit = 0
      for (let dy = 0; dy < S && !hit; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const px = x * S + dx, py = y * S + dy
          if (px >= w || py >= h) continue
          if (d[(py * w + px) * 4 + 3] > 55) { hit = 1; break }
        }
      }
      mask[y * mw + x] = hit
    }
  }
  const seen = new Uint8Array(mw * mh)
  const qx = new Int32Array(mw * mh), qy = new Int32Array(mw * mh)
  let qh = 0, qt = 0
  const cx = mw >> 1, cy = mh >> 1
  let start = -1
  for (let r = 0; r < Math.max(mw, mh) && start < 0; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy
        if (x < 0 || y < 0 || x >= mw || y >= mh) continue
        if (mask[y * mw + x]) { start = y * mw + x; break }
      }
      if (start >= 0) break
    }
  }
  if (start >= 0) {
    seen[start] = 1
    qx[qt] = start % mw; qy[qt] = (start / mw) | 0; qt++
    while (qh < qt) {
      const x = qx[qh], y = qy[qh]
      qh++
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue
          const id = ny * mw + nx
          if (seen[id] || !mask[id]) continue
          seen[id] = 1; qx[qt] = nx; qy[qt] = ny; qt++
        }
      }
    }
  }
  for (let y = 0; y < h; y++) {
    const my = (y / S) | 0
    for (let x = 0; x < w; x++) {
      if (!seen[my * mw + ((x / S) | 0)]) d[(y * w + x) * 4 + 3] = 0
    }
  }
  ctx.putImageData(img, 0, 0)
  return src
}

function bbox(src) {
  const ctx = src.getContext('2d', { willReadFrequently: true })
  const { width: w, height: h } = src
  const d = ctx.getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 50) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}

async function seek(t) {
  v.currentTime = t
  await new Promise((r) => { v.onseeked = r })
  await new Promise((r) => setTimeout(r, 120))
}

window.prepare = async (N) => {
  await new Promise((res, rej) => {
    v.onloadedmetadata = res
    v.onerror = () => rej(new Error('video load failed'))
    v.src = ${JSON.stringify(videoUrl)}
    v.load()
  })
  const dur = v.duration
  const times = Array.from({ length: N }, (_, i) => dur * ((i + 0.5) / N))
  // 用第一帧（花苞）的包围盒中心当固定中心：
  // 花苞一定长在花头的位置上，而后期帧会被背景杂物撑大、把中心带偏
  let cx = v.videoWidth / 2, cy = v.videoHeight / 2
  const sizes = []
  for (let i = 0; i < times.length; i++) {
    await seek(times[i])
    const b = bbox(keepCenterBlob(keyFrame(v.videoWidth, v.videoHeight)))
    if (!b) continue
    if (i === 0) { cx = (b.x0 + b.x1) / 2; cy = (b.y0 + b.y1) / 2 }
    sizes.push(Math.max(b.w, b.h))
  }
  return { dur, W: v.videoWidth, H: v.videoHeight, sizes, cx, cy }
}

window.grabFrame = async (t, size, outH, cx, cy) => {
  await seek(t)
  const src = keepCenterBlob(keyFrame(v.videoWidth, v.videoHeight))
  const cw = Math.min(size, v.videoWidth), ch = Math.min(size, v.videoHeight)
  let x = Math.round(cx - cw / 2)
  let y = Math.round(cy - ch / 2)
  x = Math.max(0, Math.min(v.videoWidth - cw, x))
  y = Math.max(0, Math.min(v.videoHeight - ch, y))
  const c = document.getElementById('c')
  const k = outH / ch
  c.width = Math.round(cw * k)
  c.height = outH
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.drawImage(src, x, y, cw, ch, 0, 0, c.width, c.height)
  return c.toDataURL('image/webp', 0.88)
}
</script>`

const tmp = './.tmp-assets/_key.html'
await fs.mkdir('./.tmp-assets', { recursive: true })
await fs.writeFile(tmp, html)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
await page.goto(toUrl(await fs.realpath(tmp)), { waitUntil: 'load' })
await page.waitForFunction('typeof window.prepare === "function"')

const info = await page.evaluate((n) => window.prepare(n), N)
// 用 85 分位定尺：有几帧的包围盒被背景杂物撑满，用最大值会把这些帧的尺寸套给所有帧
// 有些帧的包围盒被背景杂物撑满，靠它定尺会把每帧都裁成整幅。
// 改成固定窗口：以全序列包围盒中心的中位数为中心，边长取画面的 72%，
// 这样花体比例稳定，边缘杂物留给渲染端的柔边遮罩处理。
const size = Math.round(Math.min(info.W, info.H) * 0.80)
console.log(
  `时长 ${info.dur.toFixed(1)}s  ${info.W}x${info.H}  花心中位 (${info.cx.toFixed(0)},${info.cy.toFixed(0)}) → 固定裁切 ${size}px`,
)

await fs.mkdir(outDir, { recursive: true })
const times = Array.from({ length: N }, (_, i) => info.dur * ((i + 0.5) / N))
let bytes = 0
for (let i = 0; i < N; i++) {
  const url = await page.evaluate(
    (t, s, h, x, y) => window.grabFrame(t, s, h, x, y),
    times[i], size, OUT_H, info.cx, info.cy - size * SHY,
  )
  const buf = Buffer.from(url.split(',')[1], 'base64')
  await fs.writeFile(`${outDir}/${String(i).padStart(2, '0')}.webp`, buf)
  bytes += buf.length
  process.stdout.write(`\r${i + 1}/${N}  ${(bytes / 1024).toFixed(0)}KB`)
}
console.log(`\n写好了 ${N} 帧 -> ${outDir}`)
await browser.close()
