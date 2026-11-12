#!/usr/bin/env node
/**
 * Generates the website and Android design tokens from design/tokens.json so the two platforms cannot drift apart.
 *
 *   node design/build-tokens.cjs           write the generated files
 *   node design/build-tokens.cjs --check   exit 1 if a generated file is out of date (used by the tests)
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, 'tokens.json'), 'utf8'))

const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
const rem = (px) => `${+(px / 16).toFixed(4)}rem`
const ratio = (line, size) => +(line / size).toFixed(4)

function renderCss(t) {
  const lines = ['/* GENERATED from design/tokens.json by design/build-tokens.cjs. Do not edit by hand. */', '@theme {']
  lines.push("  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;")
  for (const [k, v] of Object.entries(t.color)) lines.push(`  --color-${kebab(k)}: ${v};`)
  for (const [k, v] of Object.entries(t.radius)) lines.push(`  --radius-${k}: ${v}px;`)
  for (const [k, s] of Object.entries(t.type)) {
    lines.push(`  --text-${k}: ${rem(s.size)};`)
    lines.push(`  --text-${k}--line-height: ${ratio(s.line, s.size)};`)
    lines.push(`  --text-${k}--letter-spacing: ${s.tracking}em;`)
    lines.push(`  --text-${k}--font-weight: ${s.weight};`)
  }
  lines.push(`  --container-reading: ${rem(t.layout.reading)};`)
  lines.push(`  --container-app: ${rem(t.layout.app)};`)
  lines.push(`  --ease-standard: ${t.motion.easing};`)
  lines.push(`  --shadow-overlay: ${t.elevation.overlay};`)
  lines.push('  --breakpoint-xs: 30rem;')
  lines.push('}', '', ':root {')
  for (const [k, v] of Object.entries(t.space)) lines.push(`  --space-${k}: ${rem(v)};`)
  lines.push(`  --gutter: ${rem(t.layout.gutter)};`)
  for (const k of ['fast', 'base', 'slow']) lines.push(`  --motion-${k}: ${t.motion[k]}ms;`)
  lines.push('}', '')
  return lines.join('\n')
}

function renderTs(t) {
  const body = {
    // The app has two themes (the website one): the light palette plus a few app-only colours, and a complete dark palette.
    colors: { ...t.color, accentPressed: t.color.accentHover, ...t.android.light },
    colorsDark: { ...t.android.dark, accentPressed: t.android.dark.accentHover },
    space: t.space,
    radius: t.radius,
    type: t.type,
    layout: t.layout,
    motion: t.motion,
  }
  return [
    '// GENERATED from design/tokens.json by design/build-tokens.cjs. Do not edit by hand.',
    `export const tokens = ${JSON.stringify(body, null, 2)} as const`,
    '',
  ].join('\n')
}

const outputs = [
  { file: path.join(root, 'frontend', 'src', 'design', 'tokens.css'), content: renderCss(tokens) },
  { file: path.join(root, 'mobile', 'src', 'ui', 'tokens.generated.ts'), content: renderTs(tokens) },
]

if (require.main === module) {
  const check = process.argv.includes('--check')
  let stale = false
  for (const { file, content } of outputs) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null
    if (check) {
      if (current !== content) {
        console.error('OUT OF DATE:', path.relative(root, file), '(run: node design/build-tokens.cjs)')
        stale = true
      }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
      console.log('wrote', path.relative(root, file))
    }
  }
  if (check) {
    if (stale) process.exit(1)
    console.log('design tokens are up to date')
  }
}

module.exports = { renderCss, renderTs, tokens }
