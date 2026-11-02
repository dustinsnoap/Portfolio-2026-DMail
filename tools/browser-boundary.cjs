const fs = require('node:fs')
const path = require('node:path')

// data: and blob: are local photo bytes, not permission to contact another host.
function checkConnectPolicy(policy, file) {
    const directives = policy.split(';').map(value => value.trim().split(/\s+/))
    const connections = directives.filter(parts => parts[0] === 'connect-src')
    if (connections.length !== 1 || connections[0].slice(1).join(' ') !== "'self' data: blob:") {
        throw new Error(`${file}: browser connections must stay on this origin`)
    }
}

function checkResourcePolicy(policy, file) {
    checkConnectPolicy(policy, file)
    const required = { 'default-src': "'self'", 'base-uri': "'none'", 'object-src': "'none'",
        'script-src': "'self' 'wasm-unsafe-eval'", 'worker-src': "'self'",
        'style-src': "'self' 'unsafe-inline'", 'img-src': "'self' data: blob:", 'font-src': "'self'",
        'connect-src': "'self' data: blob:", 'frame-src': "'self' blob:", 'form-action': "'self'" }
    const seen = new Set()
    for (const directive of policy.split(';').map(value => value.trim()).filter(Boolean)) {
        const [name, ...values] = directive.split(/\s+/)
        const expected = name === 'frame-ancestors' ? "'none'"
            : name === 'script-src' && values.join(' ') === "'self'" ? "'self'" : required[name]
        if (!expected || seen.has(name) || values.join(' ') !== expected) {
            throw new Error(`${file}: resource policy must preserve the same-origin boundary`)
        }
        seen.add(name)
    }
    if (Object.keys(required).some(name => name !== 'worker-src' && !seen.has(name))) { throw new Error(`${file}: missing resource restrictions`) }
}

function checkBrowserBoundary(root) {
    for (const name of ['index.html', 'resume/index.html']) {
        if (name !== 'index.html' && !fs.existsSync(path.join(root, name))) { continue }
        const text = name === 'index.html' && fs.existsSync(path.join(root, 'html/head.html'))
            ? require('./html-entry.cjs').assembleHTML(root) : fs.readFileSync(path.join(root, name), 'utf8')
        const meta = text.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/?>/i)
        if (!meta) { throw new Error(`${name}: missing browser connection boundary`) }
        if (/<(?:script|link|style|img|iframe|base)\b/i.test(text.slice(0, meta.index))) {
            throw new Error(`${name}: browser policy must precede loaded resources`)
        }
        checkResourcePolicy(meta[1], name)
    }

}

module.exports = { checkBrowserBoundary, checkConnectPolicy, checkResourcePolicy }
