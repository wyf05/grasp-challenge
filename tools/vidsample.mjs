/** 采样背景视频在不同时间点的构图，用来判断手是否会在画面里漂移 */
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SRC =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_215831_c6a8989c-d716-4d8d-8745-e972a2eec711.mp4'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  defaultViewport: { width: 900, height: 900 },
})
const page = await browser.newPage()
await page.setContent(`
  <body style="margin:0;background:#fff">
    <video id="v" src="${SRC}" muted playsinline style="width:900px;height:506px;object-fit:fill"></video>
    <div id="t" style="font:12px sans-serif"></div>
  </body>`)

await page.waitForFunction(() => document.getElementById('v').readyState >= 2, { timeout: 30000 })

const times = [0, 1, 2, 3, 4, 5, 6, 7, 7.9]
for (const t of times) {
  await page.evaluate(async (time) => {
    const v = document.getElementById('v')
    await new Promise((res) => {
      const on = () => {
        v.removeEventListener('seeked', on)
        res()
      }
      v.addEventListener('seeked', on)
      v.currentTime = time
    })
  }, t)
  await new Promise((r) => setTimeout(r, 250))
  await page.screenshot({ path: `shots/vid-${String(t).replace('.', '_')}.png` })
  console.log('captured', t)
}

await browser.close()
