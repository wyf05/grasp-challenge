/**
 * 把某个目录下的图片拼成一张接触表并截图（开发用）
 * 用法：node tools/sheet.mjs <图片目录> <输出png> [列数] [格子高]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const [, , dir, out, colArg, cellArg] = process.argv
const COLS = Number(colArg || 6)
const CELL = Number(cellArg || 190)

const files = (await fs.readdir(dir))
  .filter((f) => /\.(webp|png|jpe?g)$/i.test(f))
  .sort()
const rel = path.relative('.tmp-assets', dir).replace(/\\/g, '/')

const figs = files
  .map((f) => `<figure><img src="${rel}/${f}"><figcaption>${f}</figcaption></figure>`)
  .join('')

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;font:10px system-ui;padding:8px}
.g{display:grid;grid-template-columns:repeat(${COLS},1fr);gap:6px}
figure{margin:0;border:1px solid #eee}
img{width:100%;height:${CELL}px;object-fit:contain;
background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/14px 14px;display:block}
figcaption{padding:2px 3px;color:#666}
</style><div class="g">${figs}</div>`

const tmp = './.tmp-assets/_sheet.html'
await fs.mkdir('./.tmp-assets', { recursive: true })
await fs.writeFile(tmp, html)

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
const page = await browser.newPage()
await page.setViewport({ width: 1100, height: 900 })
await page.goto('file:///' + (await fs.realpath(tmp)).replace(/\\/g, '/').replace(/^\/+/, ''), {
  waitUntil: 'load',
})
await new Promise((r) => setTimeout(r, 700))
await page.screenshot({ path: out, fullPage: true })
console.log(files.length, 'images ->', out)
await browser.close()
