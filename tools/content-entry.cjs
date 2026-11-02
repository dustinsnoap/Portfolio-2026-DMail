const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

function writeContent(destination, name, value) {
    const bytes = JSON.stringify(value, null, 4) + '\n'
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    const url = `/script/content/${name}.${hash}.json`
    fs.mkdirSync(path.join(destination, 'script/content'), { recursive: true })
    fs.writeFileSync(path.join(destination, url), bytes)
    return url
}

// Use the SEO catalog as the source for summaries, search text, and deferred bodies.
async function prepareContent(directory, destination, catalogs, names) {
    const { identityText } = require('./prepare-release.cjs')
    const { summarize } = await import(require('node:url').pathToFileURL(path.join(directory, 'script/mailbox/state.js')))
    const { searchContent } = await import(require('node:url').pathToFileURL(path.join(directory, 'script/search/search.js')))
    const emails = {}
    const threads = new Map()
    for (const catalog of catalogs) {
        const authored = JSON.parse(JSON.stringify(catalog, (_, value) => typeof value === 'string' ? identityText(value, names) : value))
        for (const email of Object.values(authored.emails)) {
            if (Object.hasOwn(emails, email.id)) { throw new Error(`Duplicate portfolio email: ${email.id}`) }
            emails[email.id] = email
            if (!threads.has(email.threadId)) { threads.set(email.threadId, {}) }
            threads.get(email.threadId)[email.id] = email.data.body
        }
    }
    const bodies = new Map([...threads].map(([id, messages]) => [id, writeContent(destination, 'thread', messages)]))
    const summaries = Object.fromEntries(Object.values(emails).map(email => [email.id, { ...email,
        data: { ...email.data, summary: summarize(email.data.body, email.data.format),
            body: email.data.format === 'rich' ? [] : '', bodySource: bodies.get(email.threadId) } }]))
    const url = writeContent(destination, 'catalog', { emails: summaries })
    const search = writeContent(destination, 'search', Object.fromEntries(Object.values(emails).map(email => [email.id, searchContent(email)])))
    const entry = path.join(destination, 'index.html')
    fs.writeFileSync(entry, fs.readFileSync(entry, 'utf8').replace(/<\/head>/,
        `    <meta name="portfolio-content" content="${url}">\n    <meta name="portfolio-search" content="${search}">\n</head>`)
        .replace(/<link\b[^>]*rel="preload"[^>]*href="\/api\/portfolio\/assets\/data\/(?:emails|writing)\.json[^>]*>\s*/g, ''))
    return url
}

module.exports = { prepareContent }
