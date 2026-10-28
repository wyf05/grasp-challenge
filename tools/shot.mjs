/**
 * 截图 / 交互脚本（开发用）
 * 用法：
 *   node tools/shot.mjs <url> <out.png> [waitMs] [width] [height] [--act=<js>]
 * 例：
 *   node tools/shot.mjs "http://127.0.0.1:5183/#play" shots/g.png 8000 430 900
 *   加 --act 可在截图前执行一段页面脚本，例如模拟拖动
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const [, , url, out, waitArg, wArg, hArg, ...rest] = process.argv
const waitMs = Number(waitArg || 4000)
const width = Number(wArg || 430)
const height = Number(hArg || 900)
const actArg = rest.find((a) => a.startsWith('--act='))
const act = actArg ? actArg.slice(6) : null
const evalArg = rest.find((a) => a.startsWith('--eval='))
const evalExpr = evalArg ? evalArg.slice(7) : null
const scaleArg = rest.find((a) => a.startsWith('--scale='))
// 投稿用的图要更清晰：布局不变，只把像素密度翻倍
const scale = Number(scaleArg ? scaleArg.slice(8) : 1) || 1

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
  defaultViewport: { width, height, deviceScaleFactor: scale },
})

const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text())
})

await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
await new Promise((r) => setTimeout(r, 600))

if (act) {
  try {
    await page.evaluate(act)
  } catch (e) {
    errors.push('act: ' + e.message)
  }
}

await new Promise((r) => setTimeout(r, waitMs))
await page.screenshot({ path: out })

if (evalExpr) {
  try {
    console.log('eval:', JSON.stringify(await page.evaluate(evalExpr)))
  } catch (e) {
    console.log('eval error:', e.message)
  }
}

if (errors.length) {
  console.log('--- 页面错误 ---')
  errors.slice(0, 8).forEach((e) => console.log(e))
} else {
  console.log('no page errors')
}
console.log('saved', out)
await browser.close()
