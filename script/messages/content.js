const TAGS = new Set(['div', 'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'span', 'font', 'a', 'ul', 'ol', 'li', 'blockquote', 'img'])
const STYLES = {
    color: /^(#[\da-f]{3,8}|rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\))$/i,
    'font-family': /^(Arial|Georgia|Verdana|Courier New)$/,
    'font-size': /^(10|13|16|18|24|32|48)px$/,
    'text-align': /^(left|center|right)$/,
    'font-weight': /^(bold|700)$/,
    'font-style': /^italic$/,
    'text-decoration': /^(underline|line-through)$/,
}

export function escapeHtml(value = '') {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function safeLink(value) {
    if (typeof value !== 'string' || value.length > 2048) { return '' }
    try {
        const url = new URL(value.trim())
        return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : ''
    } catch {
        return ''
    }
}

export function normalizeContent(content) {
    let count = 0
    let images = 0
    let imageSize = 0
    let textSize = 0
    function normalizePhoto(node, result) {
        if (typeof node.src === 'string' &&
            /^\/api\/portfolio\/messages\/(message|reply)-[\w-]{8,90}\/photos\/photo-[\w-]{8,90}$/.test(node.src)) {
            if (++images > 3) { throw new TypeError('Use up to three photos') }
            result.src = node.src
            result.alt = typeof node.alt === 'string' ? node.alt.slice(0, 200) : 'Inserted photo'
            return
        }
        if (typeof node.src !== 'string' || !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(node.src)) {
            throw new TypeError('Photos must be PNG, JPEG, GIF, or WebP')
        }
        imageSize += node.src.length
        if (++images > 3 || node.src.length > 720000 || imageSize > 2000000) {
            throw new TypeError('Use up to three photos, each under 500 KB')
        }
        result.src = node.src
        result.alt = typeof node.alt === 'string' ? node.alt.slice(0, 200) : 'Inserted photo'
    }

    function normalizeNode(node, depth) {
        if (++count > 2000) { throw new TypeError('This message has too much formatting') }
        if (typeof node === 'string') {
            textSize += node.length
            if (textSize > 10000) { throw new TypeError('Keep the message under 10,000 characters') }
            return node
        }
        if (!node || !TAGS.has(node.tag)) { throw new TypeError('Unsupported message content') }
        const result = { tag: node.tag }
        if (node.tag === 'img') {
            normalizePhoto(node, result)
        } else if (node.tag !== 'br') { result.children = normalize(node.children ?? [], depth + 1) }
        if (node.tag === 'a') {
            result.href = safeLink(node.href)
            if (!result.href) { throw new TypeError('Use an http, https, or email link') }
        }
        const style = normalizeStyles(node.style)
        if (Object.keys(style).length) { result.style = style }
        return result
    }

    function normalize(nodes, depth) {
        if (!Array.isArray(nodes) || depth > 30) { throw new TypeError('Invalid message content') }
        return nodes.map(node => normalizeNode(node, depth))
    }
    return normalize(content, 0)
}

function normalizeStyles(source) {
    const style = {}
    if (!source || typeof source !== 'object') { return style }
    for (const [key, value] of Object.entries(source)) {
        if (Object.hasOwn(STYLES, key) && typeof value === 'string' && STYLES[key].test(value)) { style[key] = value }
    }
    return style
}

export function contentText(content) {
    return content
        .map((node) => {
            if (typeof node === 'string') { return node }
            if (node.tag === 'img') { return '[Photo]' }
            if (node.tag === 'br') { return '\n' }
            const text = contentText(node.children ?? [])
            return ['div', 'p', 'li', 'blockquote'].includes(node.tag) ? `${text}\n` : text
        })
        .join('')
}

export function contentHtml(content) {
    return normalizeContent(content).map(renderNode).join('')
}

function renderNode(node) {
    if (typeof node === 'string') { return escapeHtml(node) }
    const style = node.style
        ? ` style="${escapeHtml(
              Object.entries(node.style)
                  .map(([key, value]) => `${key}:${value}`)
                  .join(';'),
          )}"`
        : ''
    if (node.tag === 'br') { return '<br>' }
    if (node.tag === 'img') { return `<img src="${node.src}" alt="${escapeHtml(node.alt)}">` }
    const link = node.tag === 'a' ? ` href="${escapeHtml(node.href)}" target="_blank" rel="noopener noreferrer"` : ''
    const tag = node.tag === 'font' ? 'span' : node.tag
    return `<${tag}${style}${link}>${node.children.map(renderNode).join('')}</${tag}>`
}

// Persist only allowlisted document nodes; raw editor HTML must never enter storage.
export function readContent(root) {
    function read(nodes) {
        return Array.from(nodes).flatMap((node) => {
            if (node.nodeType === 3) { return [node.textContent] }
            if (node.nodeType !== 1 || node.hasAttribute('data-dictation-preview')) { return [] }
            const tag = node.tagName.toLowerCase()
            if (['script', 'style', 'iframe', 'object', 'svg'].includes(tag)) { return [] }
            if (!TAGS.has(tag)) { return read(node.childNodes) }
            const result = { tag }
            if (tag === 'img') {
                result.src = node.getAttribute('src')
                result.alt = node.getAttribute('alt') ?? 'Inserted photo'
            } else if (tag !== 'br') { result.children = read(node.childNodes) }
            if (tag === 'a') {
                result.href = safeLink(node.getAttribute('href'))
                if (!result.href) { return result.children }
            }
            const style = readStyles(node)
            if (Object.keys(style).length) { result.style = style }
            return [result]
        })
    }
    return normalizeContent(read(root.childNodes))
}

function readStyles(node) {
    const style = {}
    for (let index = 0; index < node.style.length; index++) {
        const key = node.style.item(index)
        if (Object.hasOwn(STYLES, key)) { style[key] = node.style.getPropertyValue(key).replace(/['"]/g, '') }
    }
    if (node.tagName === 'FONT') {
        style.color ||= node.getAttribute('color') ?? ''
        style['font-family'] ||= node.getAttribute('face') ?? ''
        const size = ['10', '13', '16', '18', '24', '32', '48'][Number(node.getAttribute('size')) - 1]
        if (size) { style['font-size'] = `${size}px` }
    }
    return style
}
