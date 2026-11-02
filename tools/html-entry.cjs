const fs = require('node:fs')
const path = require('node:path')

function indentHTML(content, indentation) {
    const blocks = []
    const protectedText = content.replace(/<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, block => {
        blocks.push(block)
        return `\0${blocks.length - 1}\0`
    })
    return protectedText.split('\n').map(line => line ? indentation + line : '').join('\n')
        .replace(/\0(\d+)\0/g, (_, index) => blocks[index])
}

function readHTML(directory, name = 'index.html') {
    const file = path.resolve(directory, name)
    if (!fs.existsSync(file)) { throw new Error(`Missing HTML source: ${name}`) }
    const relative = path.relative(path.resolve(directory), fs.realpathSync(file))
    if (relative.startsWith('..') || path.isAbsolute(relative)) { throw new Error(`HTML include leaves the source tree: ${name}`) }
    return fs.readFileSync(file, 'utf8')
}

function insertChildren(html, parent, children) {
    const openings = [...html.matchAll(/^([ ]*)<div\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gm)].filter(opening => {
        const attributes = [...opening[2].matchAll(/(?:^|\s)([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)]
        const classes = attributes.find(attribute => attribute[1].toLowerCase() === 'class')
        return (classes?.[2] ?? classes?.[3] ?? '').split(/\s+/).includes(parent)
    })
    if (openings.length !== 1) { throw new Error(`Expected exactly one .${parent} HTML parent; found ${openings.length}`) }
    const opening = openings[0]
    const markup = children.map(child => indentHTML(child.trimEnd(), opening[1] + '    ')).join('\n')
    const position = opening.index + opening[0].length
    return html.slice(0, position) + '\n' + markup + html.slice(position)
}

// The builder owns child placement; source HTML declares only the parent containers.
function assembleHTML(directory) {
    let html = readHTML(directory)
    if (fs.existsSync(path.join(directory, 'html/head.html'))) {
        if ((html.match(/<head>\s*<\/head>/g) || []).length !== 1) { throw new Error('Expected one empty head container') }
        html = html.replace(/<head>\s*<\/head>/, () => '<head>\n' + indentHTML(readHTML(directory, 'html/head.html').trimEnd(), '        ')
            + '\n    </head>')
    }
    for (const [parent, files] of [
        ['app', ['html/header.html']],
        ['workspace', ['html/sidebar.html', 'html/mailbox.html']],
    ]) {
        html = insertChildren(html, parent, files.map(file => readHTML(directory, file)))
    }
    return html
}

// Emit optional panels as lazy browser modules.
function prepareHTML(source, destination) {
    const html = fs.existsSync(path.join(source, 'html')) ? assembleHTML(source) : readHTML(source)
    const templates = [
        ['html/panels/about.html', 'script/app/about-template.js'],
        ['html/panels/search-options.html', 'script/search/search-options-template.js'],
    ]
    for (const [input, output] of templates) {
        if (!fs.existsSync(path.join(source, 'html'))) { continue }
        const markup = readHTML(source, input).replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')
        const target = path.join(destination, output)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, '// Generated from ' + input + '; edit that HTML file.\nexport default `\n' + markup + '`\n')
    }
    fs.writeFileSync(path.join(destination, 'index.html'), html)
}

module.exports = { assembleHTML, prepareHTML, readHTML }
