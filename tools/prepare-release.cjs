const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { loadPublicCatalogs, RESUME_PATH, siteSettings, writeResumeRedirect } = require('./content-source.cjs')
const { prepareHTML, readHTML } = require('./html-entry.cjs')
const root = path.resolve(__dirname, '..')
const origin = 'https://dustinsnoap.com'

// Read bundled identity settings with optional process-variable overrides.
function siteNames(environment = process.env) {
    const settings = siteSettings(environment)
    return { owner: settings.DMAIL_OWNER_NAME?.trim() || 'Portfolio Owner', chatbot: settings.DMAIL_CHATBOT_NAME?.trim() || 'Chatbot' }
}

function htmlText(value) {
    return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function identityText(text, names) {
    const values = { OWNER_NAME: names.owner, CHATBOT_NAME: names.chatbot,
        OWNER_FIRST_NAME: names.owner === 'Portfolio Owner' ? 'Owner' : names.owner.split(/\s+/)[0] }
    return text.replace(/\{\{(OWNER_NAME|OWNER_FIRST_NAME|CHATBOT_NAME)\}\}/g, (_, key) => values[key])
}

// Materialize display names in the isolated preview while preserving source templates.
function applyIdentity(directory, names = siteNames()) {
    for (const file of ['index.html']) {
        const target = path.join(directory, file)
        if (fs.existsSync(target)) {
            const escaped = { owner: htmlText(names.owner), chatbot: htmlText(names.chatbot) }
            fs.writeFileSync(target, identityText(fs.readFileSync(target, 'utf8'), escaped))
        }
    }
    const target = path.join(directory, 'script/app/identity.js')
    if (!fs.existsSync(target)) { return }
    // Encode display names as JavaScript literals without interpreting replacement metacharacters.
    const quote = value => "'" + JSON.stringify(value).slice(1, -1).replace(/'/g, "\\'") + "'"
    const identity = fs.readFileSync(target, 'utf8')
        .replace(/export const OWNER_NAME = [^\n]+/, () => `export const OWNER_NAME = ${quote(names.owner)}`)
        .replace(/export const CHATBOT_NAME = [^\n]+/, () => `export const CHATBOT_NAME = ${quote(names.chatbot)}`)
    fs.writeFileSync(target, identity)
}

// Load the same rendering modules as the browser while retaining one state module identity in the source authoring tools.
async function publicModules(directory = root) {
    const load = name => import(pathToFileURL(path.join(directory, `script/${name}.js`)))
    const [pages, render, markup, history, content] = await Promise.all(
        ['navigation/conversation-links', 'mailbox/render', 'messages/thread-markup',
            'messages/thread-history', 'messages/content'].map(load))
    const renderSource = fs.readFileSync(path.join(directory, 'script/mailbox/render.js'), 'utf8')
    const statePath = renderSource.match(/from '(\.\/state\.js[^']*)'/)[1]
    const state = await import(new URL(statePath, pathToFileURL(path.join(directory, 'script/mailbox/render.js'))))
    return { ...pages, ...render, ...markup, ...history, ...content, ...state }
}

// Read authored catalogs only, leaving visitor storage, drafts and opening-trigger messages outside the public page set.
function publicCatalog(modules, catalogs, names) {
    const allowed = new Set(modules.PUBLIC_PAGES.map(([, thread]) => thread))
    const emails = {}
    for (const catalog of catalogs) {
        const authored = JSON.parse(JSON.stringify(catalog, (_, value) =>
            typeof value === 'string' ? identityText(value, names) : value))
        for (const [id, email] of Object.entries(authored.emails)) {
            if (email.folder === 'primary' && !email.delivery || allowed.has(email.threadId) && !email.delivery && email.folder !== 'drafts') {
                emails[id] = email
            }
        }
    }
    return { emails }
}

// Serialize metadata as inert JSON without allowing authored text to close its script data block.
function jsonData(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c')
}

// Describe the bundled sample pages using their visible content.
function metadata(modules, route, messages, names) {
    const url = origin + route
    const first = messages?.[0]
    const summary = first?.data.summary || `Projects and writing by ${names.owner}, ` +
        'a software engineer building backend systems, APIs, and data pipelines.'
    const title = first ? `${first.data.subject} · Dmail` : route === '/about' ? `About ${names.owner} · Dmail` : 'Dmail'
    const person = { '@type': 'Person', '@id': origin + '/#portfolio-owner', name: names.owner, url: origin + RESUME_PATH,
        image: origin + '/api/portfolio/assets/img/me.jpg', sameAs: [] }
    const schema = first ? { '@context': 'https://schema.org', '@type': 'BlogPosting', '@id': url,
        headline: first.data.subject, author: person, mainEntityOfPage: url,
        datePublished: first.timestamp, dateModified: messages.at(-1).timestamp }
        : { '@context': 'https://schema.org', '@type': 'WebSite', url: origin + '/', name: 'Dmail', author: person }
    const escape = modules.escapeHtml
    return `<meta name="description" content="${escape(summary)}" />
        <link rel="canonical" href="${escape(url)}" />
        <meta property="og:type" content="${first ? 'article' : 'website'}" />
        <meta property="og:title" content="${escape(title)}" />
        <meta property="og:description" content="${escape(summary)}" />
        <meta property="og:url" content="${escape(url)}" />
        <meta property="og:image" content="${origin}/api/portfolio/assets/img/me.jpg" />
        <meta name="twitter:card" content="summary" />
        <script type="application/ld+json">${jsonData(schema)}</script>`
}

// Render the existing inbox shell and public conversation without requiring a crawler to open client controls.
function renderPublicPage(template, modules, catalog, page, names, about) {
    const [route, thread, view] = page
    modules.init(catalog)
    modules.setActiveCategory(view)
    const state = modules.getState()
    const messages = thread ? state.threads[thread]?.messages : null
    if (thread && !messages?.length) { throw new Error(`Missing authored public conversation: ${thread}`) }
    const rows = modules.getVisiblePage().threads.map(item => modules.buildEmailRow(item.latest, item.messages.length, {})).join('')
    let html = template.replace('<div class="email-list"></div>', `<div class="email-list">${rows}</div>`)
    if (messages) {
        const body = modules.buildThreadHeader() + `<div class="thread"><div class="thread-heading">
            <h1 class="thread-subject">${modules.escapeHtml(messages[0].data.subject)}</h1></div>` +
            modules.buildThreadStack(messages, false, true) + modules.buildThreadFooter() + '</div>'
        html = html.replace('<section class="mail"></section>', `<section class="mail visible" data-thread-id="${thread}">${body}</section>`)
        html = html.replace('<title>Dmail</title>', `<title>${modules.escapeHtml(messages[0].data.subject)} · Dmail</title>`)
    }
    if (route === '/about') {
        const content = identityText(about, { owner: htmlText(names.owner), chatbot: htmlText(names.chatbot) })
            .replaceAll('about-title', 'public-about-title')
            .replace(/<button\b(?=[^>]*aria-label="Close About")[^>]*>[\s\S]*?<\/button>/, '')
        const body = modules.buildThreadHeader() + '<div class="thread"><div class="thread-heading">' +
            '<h1 class="thread-subject">About ' + htmlText(names.owner) + '</h1></div>' +
            '<article class="about-panel public-about">' + content + '</article></div>'
        html = html.replace('<section class="mail"></section>',
            '<section class="mail visible" data-public-page="about">' + body + '</section>')
    }
    return html.replace(/<!-- PUBLIC_METADATA -->[\s\S]*?<!-- \/PUBLIC_METADATA -->/, metadata(modules, route, messages, names))
}

// Remove generated layout indentation to reduce public transfer size while retaining bounded, readable lines.
// Message text, preformatted elements and structured data retain their original whitespace verbatim.
function formatPublicHTML(html) {
    const lines = []
    let current = ''
    let offset = 0
    function flush() {
        if (current) { lines.push(current); current = '' }
    }
    // Pack existing layout lines without splitting attributes, entities or authored text.
    function markup(value) {
        for (const line of value.split('\n')) {
            const content = line.trim()
            if (!content) { continue }
            if (current && current.length + content.length + 1 > 120) { flush() }
            current += (current ? ' ' : '') + content
        }
    }
    const protectedBlocks = /<(script|style|pre|textarea)\b[^>]*>[\s\S]*?<\/\1>|<div\b[^>]*class="[^"]*\bplain-text\b[^"]*"[^>]*>[\s\S]*?<\/div>/g
    for (const match of html.matchAll(protectedBlocks)) {
        markup(html.slice(offset, match.index))
        flush()
        lines.push(match[0])
        offset = match.index + match[0].length
    }
    markup(html.slice(offset))
    flush()
    const result = lines.join('\n') + '\n'
    if (result.trimEnd().split('\n').length > 500) { throw new Error('Generated public HTML exceeds the 500-line source limit') }
    return result
}

// Publish static public pages, an explicit search-crawler policy and a sitemap from the same approved catalog.
async function buildPublicPages(destination, catalogs) {
    const names = siteNames()
    applyIdentity(destination, names)
    const runtime = fs.existsSync(path.join(destination, 'script/mailbox/render.js')) ? destination : root
    const modules = await publicModules(runtime)
    const catalog = publicCatalog(modules, catalogs ?? await loadPublicCatalogs(), names)
    const template = fs.readFileSync(path.join(destination, 'index.html'), 'utf8')
    const about = readHTML(root, 'html/panels/about.html')
    const pages = [['/', '', 'primary'], ['/about', '', 'primary'], ...modules.PUBLIC_SECTIONS, ...modules.PUBLIC_PAGES]
    for (const page of pages) {
        const target = path.join(destination, page[0] === '/about' ? '/projects/about' : page[0], 'index.html')
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, formatPublicHTML(renderPublicPage(template, modules, catalog, page, names, about)))
    }
    writeResumeRedirect(destination)
    const urls = [...pages.map(([url]) => origin + url), origin + RESUME_PATH]
    fs.writeFileSync(path.join(destination, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urls.map(url => `  <url><loc>${url}</loc></url>`).join('\n') + '\n</urlset>\n')
    const resumeRule = 'Allow: /api/portfolio/assets/\n'
    fs.writeFileSync(path.join(destination, 'robots.txt'), 'User-agent: *\nAllow: /\nDisallow: /api/\n' + resumeRule +
        `Disallow: /signin\nDisallow: /signup\n\nSitemap: ${origin}/sitemap.xml\n`)
    return { pages: pages.length, urls }
}

function releaseSources(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name)
        return entry.isDirectory() ? releaseSources(file) : /\.(js|css|html)$/.test(file) ? [file] : []
    })
}

// Give every browser dependency one content-derived version so cached modules cannot split shared application state.
function prepareRelease(directory, catalogs = []) {
    require('./browser-boundary.cjs').checkBrowserBoundary(directory)
    applyIdentity(directory)
    const files = ['script', 'style', 'resume'].map(name => path.join(directory, name))
        .filter(folder => fs.existsSync(folder)).flatMap(releaseSources)
    files.push(path.join(directory, 'index.html'))
    const hash = crypto.createHash('sha256')
    const source = files.sort().map(file => ({ file, text: fs.readFileSync(file, 'utf8') }))
    for (const item of source) { hash.update(path.relative(directory, item.file)).update('\0').update(item.text).update('\0') }
    for (const catalog of catalogs) { hash.update(JSON.stringify(catalog)).update('\0') }
    const version = hash.digest('hex').slice(0, 16)
    for (const item of source) {
        let text = item.text
            .replace(/(\b(?:from\s*|import\s*(?:\(\s*)?)['"])([^'"\n]+\.js)(?:\?v=[\w.-]+)?(['"])/g,
                `$1$2?v=${version}$3`)
            .replace(/((?:src|href)=["'])([^"'\n<>]+\.(?:js|css))(?:\?v=[\w.-]+)?(["'])/g,
                `$1$2?v=${version}$3`)
        if (['index.html', 'main.js'].includes(path.basename(item.file))) {
            text = text.replace(/(\/api\/portfolio\/assets\/data\/(?:emails|writing)\.json)(?:\?v=[\w.-]+)?(?=["'])/g,
                `$1?v=${version}`)
        }
        fs.writeFileSync(item.file, text)
    }
    return version
}

// Build an isolated browser preview without changing authoring files.
async function preparePreview(directory = path.resolve(__dirname, '..'), results, catalogs) {
    results ??= path.join(require('node:os').tmpdir(), 'dmail-previews')
    fs.mkdirSync(results, { recursive: true })
    const destination = fs.mkdtempSync(path.join(results, 'release-'))
    catalogs ??= await loadPublicCatalogs()
    for (const name of ['index.html', 'script', 'style', 'assets']) {
        fs.cpSync(path.join(directory, name), path.join(destination, name), { recursive: true })
    }
    prepareHTML(directory, destination)
    await require('./content-entry.cjs').prepareContent(directory, destination, catalogs, siteNames())
    prepareRelease(destination, catalogs)
    await buildPublicPages(destination, catalogs)
    return destination
}

if (require.main === module) {
    preparePreview(path.resolve(process.argv[2] || root)).then(directory => console.log(`Prepared release: ${directory}`))
        .catch(error => { console.error(error.message); process.exitCode = 1 })
}
module.exports = { applyIdentity, buildPublicPages, formatPublicHTML, identityText, prepareRelease, preparePreview, siteNames }
