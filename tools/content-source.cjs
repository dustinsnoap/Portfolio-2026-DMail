const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const ASSET_PATH = '/api/portfolio/assets'
const RESUME_PATH = ASSET_PATH + '/resume/index.html'

function siteSettings(environment = process.env) {
    const site = JSON.parse(fs.readFileSync(path.join(root, 'assets/site.json'), 'utf8'))
    return { DMAIL_OWNER_NAME: site.ownerName, DMAIL_CHATBOT_NAME: site.chatbotName, ...environment }
}

function demoCatalog(name) {
    if (!['emails', 'writing'].includes(name)) { throw new Error('Unknown demo catalog') }
    const settings = siteSettings()
    const names = { OWNER_NAME: settings.DMAIL_OWNER_NAME, CHATBOT_NAME: settings.DMAIL_CHATBOT_NAME }
    return JSON.parse(fs.readFileSync(path.join(root, 'assets/data', name + '.json'), 'utf8'), (_, value) =>
        typeof value === 'string' ? value.replace(/\{\{(OWNER_NAME|CHATBOT_NAME)\}\}/g, (_, key) => names[key]) : value)
}

async function loadPublicCatalogs() {
    return ['emails', 'writing'].map(demoCatalog)
}

function writeResumeRedirect(directory) {
    const template = fs.readFileSync(path.join(directory, 'index.html'), 'utf8')
    const policy = template.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0]
    const destination = path.join(directory, 'resume')
    fs.mkdirSync(destination, { recursive: true })
    const html = `<!doctype html>\n<html lang="en"><head>${policy}\n<meta charset="utf-8">\n`
        + `<meta http-equiv="refresh" content="0;url=${RESUME_PATH}">\n<title>Resume</title>\n`
        + `<link rel="canonical" href="${RESUME_PATH}"></head>\n`
        + `<body><a href="${RESUME_PATH}">Open resume</a></body></html>\n`
    fs.writeFileSync(path.join(destination, 'index.html'), html)
}

module.exports = { demoCatalog, ASSET_PATH, RESUME_PATH, loadPublicCatalogs, siteSettings, writeResumeRedirect }
