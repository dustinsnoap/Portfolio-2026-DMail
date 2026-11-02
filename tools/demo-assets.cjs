const fs = require('node:fs')
const path = require('node:path')
const { demoCatalog } = require('./content-source.cjs')

const types = { '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.html': 'text/html; charset=utf-8' }

// Keep the existing browser asset URLs while serving only the bundled public directory.
function serveDemoAsset(request, response, directory) {
    const url = new URL(request.url, 'http://localhost')
    const prefix = '/api/portfolio/assets/'
    if (!url.pathname.startsWith(prefix) && !url.pathname.startsWith('/assets/')) { return false }
    let name
    try {
        name = decodeURIComponent(url.pathname.slice(url.pathname.startsWith(prefix) ? prefix.length : '/assets/'.length))
    } catch { return missing(response) }
    if (!['GET', 'HEAD'].includes(request.method) || name.includes('\\') || name.includes('\0') ||
        name.split('/').some(part => !part || part.startsWith('.'))) { return missing(response) }
    const assets = path.resolve(directory, 'assets')
    if (['img/me.jpg', 'img/me-avatar.webp'].includes(name)) {
        name = JSON.parse(fs.readFileSync(path.join(assets, 'site.json'), 'utf8')).portrait
    }
    if (typeof name !== 'string') { return missing(response) }
    const file = path.resolve(assets, name)
    if (!file.startsWith(assets + path.sep) || !types[path.extname(file)] ||
        !fs.existsSync(file) || !fs.statSync(file).isFile()) { return missing(response) }
    const catalog = /^data\/(emails|writing)\.json$/.exec(name)
    const bytes = catalog ? Buffer.from(JSON.stringify(demoCatalog(catalog[1]))) : fs.readFileSync(file)
    response.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Content-Length': bytes.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : bytes)
    return true
}

function missing(response) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end('Not found')
    return true
}

module.exports = { serveDemoAsset }
