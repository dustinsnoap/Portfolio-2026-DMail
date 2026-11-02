const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { serveDemoAsset } = require('./demo-assets.cjs')

let root = path.resolve(__dirname, '..')
const port = Number(process.env.DMAIL_PORT || 50950)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.xml': 'application/xml', '.txt': 'text/plain' }

function missing(response) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end('Not found')
}

function staticFile(request, response) {
    let pathname
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname) } catch { return missing(response) }
    if (!['GET', 'HEAD'].includes(request.method)) { return missing(response) }
    if (/^\/(resume|reusme)\/?$/.test(pathname)) {
        response.writeHead(302, { Location: '/api/portfolio/assets/resume/index.html', 'Cache-Control': 'no-store' })
        return response.end()
    }
    if (/^\/about\/?$/.test(pathname)) { pathname = '/projects/about/index.html' }
    if (pathname === '/' || /^\/(signin|signup)\/?$/.test(pathname)) { pathname = '/index.html' }
    if (/^\/(projects|writing|updates)(?:\/[a-z0-9-]+)?\/?$/.test(pathname)) { pathname = pathname.replace(/\/$/, '') + '/index.html' }
    const allowed = /^\/(index\.html|robots\.txt|sitemap\.xml|(?:script|style|resume|projects|writing|updates)\/[^\\\0]+)$/
    if (!allowed.test(pathname) || pathname.split('/').some(part => part.startsWith('.'))) { return missing(response) }
    const file = path.resolve(root, `.${pathname}`)
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { return missing(response) }
    const bytes = fs.readFileSync(file)
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : bytes)
}

async function start() {
    const { loadPublicCatalogs } = require('./content-source.cjs')
    const { preparePreview } = require('./prepare-release.cjs')
    root = await preparePreview(root, undefined, await loadPublicCatalogs())
    const server = http.createServer((request, response) => {
        if (!serveDemoAsset(request, response, root)) { staticFile(request, response) }
    })
    server.listen(port, '127.0.0.1', () => process.stdout.write(`DMail demo: http://localhost:${port}/\n`))
}

start().catch(error => { console.error(error.message); process.exitCode = 1 })
