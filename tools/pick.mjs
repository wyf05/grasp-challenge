/**
 * 取图上若干点的颜色（开发用）
 * 用法：node tools/pick.mjs <图片> x,y x,y ...
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const [, , file, ...pts] = process.argv
if (!file || !pts.length) {
  console.error('用法: node tools/pick.mjs <图片> x,y x,y ...')
  process.exit(1)
}

const b64 = (await fs.readFile(file)).toString('base64')
const ext = file.split('.').pop().toLowerCase()
const mime = ext === 'png' ? 'image/png' : 'image/jpeg'

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
const page = await browser.newPage()
await page.goto('about:blank')

const out = await page.evaluate(
  async (src, points) => {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = src
    })
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const hex = (n) => n.toString(16).padStart(2, '0')
    return points.map((p) => {
      const [x, y] = p.split(',').map(Number)
      const d = ctx.getImageData(x, y, 1, 1).data
      return `${p} → #${hex(d[0])}${hex(d[1])}${hex(d[2])}`
    })
  },
  `data:${mime};base64,${b64}`,
  pts,
)

console.log(`${file} (${pts.length} pts)`)
out.forEach((l) => console.log('  ' + l))
await browser.close()
