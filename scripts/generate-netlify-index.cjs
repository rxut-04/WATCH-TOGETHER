/**
 * Post-build: write dist/client/index.html so Netlify can serve the SPA.
 * TanStack Start client build does not emit index.html; this script generates it
 * from the built assets (main-*.js, styles-*.css).
 */
const fs = require('fs')
const path = require('path')

const clientDir = path.join(__dirname, '..', 'dist', 'client')
const assetsDir = path.join(clientDir, 'assets')

if (!fs.existsSync(assetsDir)) {
  console.warn('generate-netlify-index: dist/client/assets not found, skipping')
  process.exit(0)
}

const files = fs.readdirSync(assetsDir)
const mainJs = files.find((f) => f.startsWith('main-') && f.endsWith('.js'))
const stylesCss = files.find((f) => f.startsWith('styles-') && f.endsWith('.css'))

if (!mainJs) {
  console.warn('generate-netlify-index: no main-*.js in assets, skipping')
  process.exit(0)
}

const cssLink = stylesCss
  ? `  <link rel="stylesheet" href="/assets/${stylesCss}" />`
  : ''

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CinemaSync</title>
  <link rel="icon" href="/favicon.ico" />
${cssLink}
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/assets/${mainJs}"></script>
</body>
</html>
`

fs.writeFileSync(path.join(clientDir, 'index.html'), html, 'utf8')
console.log('generate-netlify-index: wrote dist/client/index.html')
console.log('  entry:', mainJs, stylesCss ? `css: ${stylesCss}` : '')