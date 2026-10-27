/**
 * 从录屏里提取花朵绽放序列帧（开发用）
 *
 * 为什么这么干：参考原型的花是作者用 veo 生成的视频，原件拿不到，
 * 但录屏里花一直在跟着手开合，逐帧裁下来就等于拿到了同源素材。
 *
 * 两个关键点：
 * 1. **按面积排序，不按时间排序**。手是来回开合的，时间顺序不是绽放顺序；
 *    花瓣张得越开，非背景像素越多，用面积当"绽放度"的代理最稳。
 * 2. **固定裁切窗口**（取全序列并集包围盒 + 内边距）。若每帧各自裁到包围盒，
 *    花在序列里会被拉成一样大，"花从小开到盛"的关系就没了。
 *
 * 用法：
 *   node tools/flowerframes.mjs <视频> <outDir> <起> <止> [帧数] [输出高] [x0,y0,x1,y1]
 * 例：
 *   node tools/flowerframes.mjs "手势交互1.mp4" public/flora/peony 36.5 46.5 16 640 200,45,860,470
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const [, , file, outDir, sArg, eArg, nArg, hArg, rectArg] = process.argv
const START = Number(sArg)
const END = Number(eArg)
const N = Number(nArg || 16)
const OUT_H = Number(hArg || 640)
const RECT = (rectArg || '200,45,860,470').split(',').map(Number)
// 第 6 个参数传 fixed：直接把这个矩形当裁切窗口，不再自动求并集包围盒。
// 自动包围盒会被页面顶部角标、底部通话画面这些边缘元素带偏，实测不如手定窗口可控。
const FIXED = process.argv[8] === 'fixed'

const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '')
const videoUrl = toUrl(await fs.realpath(file))

const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#fff}canvas{display:block}</style>
<video id="v" muted playsinline preload="auto"></video>
<canvas id="c"></canvas>
<script>
const v = document.getElementById('v')
const BG = [245, 243, 237]   // 页面底色 #F5F3ED，实测三个点一致
const TOL = 12

async function seek(t) {
  v.currentTime = t
  await new Promise((r) => { v.onseeked = r })
  await new Promise((r) => setTimeout(r, 120))
}

/** 在 searchRect 内找"非页面底色"的包围盒，并统计像素数当绽放度 */
function scan(src, rect) {
  const w = src.width, h = src.height
  const ctx = src.getContext('2d', { willReadFrequently: true })
  const [x0, y0, x1, y1] = rect
  const img = ctx.getImageData(x0, y0, Math.min(x1, w) - x0, Math.min(y1, h) - y0)
  const d = img.data
  const iw = Math.min(x1, w) - x0, ih = Math.min(y1, h) - y0
  let bx0 = iw, by0 = ih, bx1 = -1, by1 = -1, area = 0
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const i = (y * iw + x) * 4
      const diff = (Math.abs(d[i] - BG[0]) + Math.abs(d[i + 1] - BG[1]) + Math.abs(d[i + 2] - BG[2])) / 3
      if (diff > TOL) {
        area++
        if (x < bx0) bx0 = x
        if (x > bx1) bx1 = x
        if (y < by0) by0 = y
        if (y > by1) by1 = y
      }
    }
  }
  if (bx1 < 0) return null
  return { area, x0: bx0 + x0, y0: by0 + y0, x1: bx1 + x0, y1: by1 + y0 }
}

function snapshot() {
  const src = document.createElement('canvas')
  src.width = v.videoWidth
  src.height = v.videoHeight
  src.getContext('2d').drawImage(v, 0, 0)
  return src
}

window.prepare = async (start, end, n, rect) => {
  await new Promise((res, rej) => {
    v.onloadedmetadata = res
    v.onerror = () => rej(new Error('video load failed'))
    v.src = ${JSON.stringify(videoUrl)}
    v.load()
  })
  const times = Array.from({ length: n }, (_, i) => start + ((end - start) * i) / Math.max(1, n - 1))
  const rows = []
  for (const t of times) {
    await seek(t)
    const b = scan(snapshot(), rect)
    if (b) rows.push({ t, area: b.area, box: [b.x0, b.y0, b.x1, b.y1] })
  }
  rows.sort((a, b) => a.area - b.area)          // 面积升序 = 花苞到盛开
  // 去重：面积差太小的帧其实是同一个绽放阶段，留着只会让 scrub 时"卡一下"
  const uniq = []
  for (const r of rows) {
    if (!uniq.length || r.area > uniq[uniq.length - 1].area * 1.005) uniq.push(r)
  }
  rows.length = 0
  rows.push(...uniq)
  const union = rows.reduce(
    (u, r) => [
      Math.min(u[0], r.box[0]), Math.min(u[1], r.box[1]),
      Math.max(u[2], r.box[2]), Math.max(u[3], r.box[3]),
    ],
    [1e9, 1e9, -1, -1],
  )
  return { times, rows, union, w: v.videoWidth, h: v.videoHeight }
}

window.grab = async (t, box, outH) => {
  await seek(t)
  const src = snapshot()
  const [x0, y0, x1, y1] = box
  const bw = x1 - x0, bh = y1 - y0
  const c = document.getElementById('c')
  const k = outH / bh
  c.width = Math.round(bw * k)
  c.height = outH
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  // 不要在这里做对比度/饱和度。原来的做法套了 contrast(1.06)，
  // 把接近纯白的页面底色 (#F5F3ED) 推成了亮白，贴回页面就露出一块矩形。
  // 素材本来就是参考的效果，原样输出即可。
  ctx.drawImage(src, x0, y0, bw, bh, 0, 0, c.width, c.height)
  return { url: c.toDataURL('image/webp', 0.9), w: c.width, h: c.height }
}
</script>`

const tmp = './.tmp-assets/_flora.html'
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

const info = await page.evaluate((s, e, n, r) => window.prepare(s, e, n, r), START, END, N, RECT)
console.log(`取 ${START}-${END}s，有效帧 ${info.rows.length}/${N}`)
const pad = Math.round(Math.max(info.union[2] - info.union[0], info.union[3] - info.union[1]) * 0.06)
const box = FIXED ? RECT.slice() : [info.union[0] - pad, info.union[1] - pad, info.union[2] + pad, info.union[3] + pad]
console.log(`并集包围盒 ${info.union.join(',')} → 裁切窗口 ${box.map((n) => Math.round(n)).join(',')}`)
console.log('绽放度（面积）:', info.rows.map((r) => r.area).join(', '))

await fs.mkdir(outDir, { recursive: true })
let bytes = 0
for (let i = 0; i < info.rows.length; i++) {
  const { url } = await page.evaluate((t, b, h) => window.grab(t, b, h), info.rows[i].t, box, OUT_H)
  const buf = Buffer.from(url.split(',')[1], 'base64')
  await fs.writeFile(`${outDir}/${String(i).padStart(2, '0')}.webp`, buf)
  bytes += buf.length
}
await fs.writeFile(`${outDir}/meta.json`, JSON.stringify({ src: file, start: START, end: END, box, frames: info.rows.map((r) => ({ t: +r.t.toFixed(2), area: r.area })) }, null, 1))
console.log(`写好了 ${info.rows.length} 帧 → ${outDir}（${(bytes / 1024).toFixed(0)}KB）`)
await browser.close()
