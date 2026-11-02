const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'))

function sources(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory() && entry.name === 'results' && path.basename(directory) === 'test') { return [] }
        const file = path.join(directory, entry.name)
        return entry.isDirectory() ? sources(file) : /\.(?:js|cjs|css|html)$/.test(entry.name) ? [file] : []
    })
}

function checkStyle(file) {
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split('\n')
    if (lines.at(-1) === '') { lines.pop() }
    const errors = []
    if (text.includes('\r')) { errors.push('use LF line endings') }
    if (!text.endsWith('\n')) { errors.push('end the file with a newline') }
    if (lines.length > 500) { errors.push(`contains ${lines.length} lines; limit is 500`) }
    lines.forEach((line, index) => {
        const singleDeclaration = file.endsWith('.css') && /^[^{}]*\{\s*[-\w]+\s*:[^{};]+;?\s*\}\s*$/.test(line)
        if (line.length > 150 && !singleDeclaration) { errors.push(`line ${index + 1} exceeds 150 characters (${line.length})`) }
        if (line.includes('\t')) { errors.push(`line ${index + 1} contains tab indentation`) }
        if (/[ \t]+$/.test(line)) { errors.push(`line ${index + 1} contains trailing whitespace`) }

    })
    return errors
}

function checkSyntax(file) {
    if (!/\.(?:js|cjs)$/.test(file)) { return [] }
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    return result.status === 0 ? [] : [result.stderr || result.error?.message || 'syntax check failed']
}

const files = ['html', 'script', 'style', 'test', 'tools', 'resume']
    .map(directory => path.join(root, directory))
    .filter(directory => fs.existsSync(directory))
    .flatMap(sources)
if (fs.existsSync(path.join(root, 'index.html'))) { files.push(path.join(root, 'index.html')) }
try { require('./browser-boundary.cjs').checkBrowserBoundary(root) } catch (error) {
    if (fs.existsSync(path.join(root, 'index.html'))) { console.error(error.message); process.exitCode = 1 }
}
const failures = files.flatMap((file) => [...checkStyle(file), ...checkSyntax(file)].map((error) => `${path.relative(root, file)}: ${error}`))
if (failures.length) {
    console.error(failures.join('\n'))
    process.exitCode = 1
} else { console.log(`Source checks passed for ${files.length} files: syntax, LF, line/file limits, tabs, trailing whitespace.`) }
