// Renders the PNG assets from the SVG logo files (run `python design/build-logo.py` first):
//   node design/build-icons.cjs
// Uses the Playwright browser that the website's tests already depend on.
const fs = require('fs')
const path = require('path')
const { chromium } = require(path.join(__dirname, '..', 'frontend', 'node_modules', '@playwright', 'test'))

const root = path.join(__dirname, '..')
const logo = (f) => fs.readFileSync(path.join(__dirname, 'logo', f), 'utf8')
const res = path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'res')
const pub = path.join(root, 'frontend', 'public')

const NAVY = '#0B1F4B'
// The dark-variant mark, taken from the app-icon SVG so that there is only one copy of the geometry.
const inner = logo('speakora-app-icon.svg').replace(/^[\s\S]*?<g transform="[^"]*">/, '').replace(/<\/g><\/svg>\s*$/, '')
const markAt = (box, scale) => {
  const size = 64 * scale
  const o = (box - size) / 2
  return `<g transform="translate(${o} ${o - 0.5 * scale}) scale(${scale})">${inner}</g>`
}
const wrap = (box, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">${body}</svg>`

const jobs = []
const png = (file, width, height, html) => jobs.push({ file, width, height, html })
const svgFile = (f, w, h) => `<body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(logo(f)).toString('base64')}" width="${w}" height="${h}"></body>`
const raw = (svg, w, h) => `<body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${w}" height="${h}"></body>`

// Website
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) png(path.join(pub, name), size, size, svgFile('speakora-app-icon.svg', size, size))
png(path.join(pub, 'og-image.png'), 1200, 630, svgFile('speakora-og.svg', 1200, 630))

// Android legacy launcher icons (API 24-25; newer phones use the adaptive icon in mipmap-anydpi-v26): a rounded square and a circle.
const dpi = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
for (const [d, px] of Object.entries(dpi)) {
  const square = wrap(px, `<rect width="${px}" height="${px}" rx="${px * 0.22}" fill="${NAVY}"/>${markAt(px, (px / 64) * 0.62)}`)
  const round = wrap(px, `<circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}" fill="${NAVY}"/>${markAt(px, (px / 64) * 0.56)}`)
  png(path.join(res, `mipmap-${d}`, 'ic_launcher.png'), px, px, raw(square, px, px))
  png(path.join(res, `mipmap-${d}`, 'ic_launcher_round.png'), px, px, raw(round, px, px))
}
// Launch screen logo (centred on the navy window background), one density-independent file.
png(path.join(res, 'drawable-nodpi', 'splash_logo.png'), 360, 360, svgFile('speakora-splash.svg', 360, 360))

;(async () => {
  const browser = await chromium.launch()
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.width, height: j.height } })
    await page.setContent(j.html)
    fs.mkdirSync(path.dirname(j.file), { recursive: true })
    await page.screenshot({ path: j.file, omitBackground: true, clip: { x: 0, y: 0, width: j.width, height: j.height } })
    await page.close()
    console.log('wrote', path.relative(root, j.file))
  }
  await browser.close()
})()
