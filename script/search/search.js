import { contentText } from '../messages/content.js'

const documents = new WeakMap()
const CATEGORIES = ['primary', 'projects', 'articles', 'updates']
const TEXT_FIELDS = new Set(['from', 'to', 'cc', 'bcc', 'subject', 'body', 'filename'])

export function invalidateSearch(message) {
    documents.delete(message)
}

export function isAllMailMessage(message, folder) {
    return !message.status.deleted && !['spam', 'trash', 'deleted', 'drafts'].includes(mailboxFolder(message, folder))
}

function normalize(value) {
    const folded = /[^\x00-\x7f]/.test(value) ? value.normalize('NFKD').replace(/\p{M}/gu, '') : value
    return folded.toLowerCase()
        .replace(/\s{2,}|[^\S ]/g, ' ')
        .trim()
}

function htmlText(value) {
    return value
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<\/?(?:br|p|div|li|blockquote)\b[^>]*>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
            const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
            if (code[0] !== '#') { return named[code.toLowerCase()] }
            const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
            return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity
        })
}

function containsPhoto(nodes) {
    return nodes.some((node) => typeof node !== 'string' && (node.tag === 'img' || containsPhoto(node.children ?? [])))
}

function documentFor(message, field) {
    let document = documents.get(message)
    if (!document) {
        document = Object.create(null)
        documents.set(message, document)
    }
    if (!Object.hasOwn(document, field)) {
        document[field] =
            field === 'all'
                ? [...TEXT_FIELDS].map((name) => documentFor(message, name)).join('\n')
                : field === 'photo'
                    ? hasPhoto(message)
                    : normalize(fieldText(message, field))
    }
    return document[field]
}

function fieldText(message, field) {
    if (field === 'body' && typeof message.data.searchBody === 'string') { return message.data.searchBody }
    if (field === 'from') { return contactText(message.from) }
    if (['to', 'cc', 'bcc'].includes(field)) {
        return (message.recipients?.[field] ?? (field === 'to' ? [message.to] : [])).map(contactText).join(' ')
    }
    if (field === 'subject') { return message.data.subject ?? '' }
    if (field === 'filename') { return (message.attachments ?? []).map((file) => file.name).join(' ') }
    return message.data.format === 'rich'
        ? contentText(message.data.body)
        : message.data.format === 'text'
            ? message.data.body
            : htmlText(message.data.body ?? '')
}

function contactText(person) {
    return `${person?.name ?? ''} ${person?.email ?? ''}`
}

function hasPhoto(message) {
    if (typeof message.data.hasPhoto === 'boolean') { return message.data.hasPhoto }
    return message.data.format === 'rich' ? containsPhoto(message.data.body) : /<img\b/i.test(message.data.body ?? '')
}

export function searchContent(message) {
    return { body: fieldText(message, 'body'), photo: hasPhoto(message) }
}

function dateValue(value) {
    const parts = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(value)
    if (!parts) { throw new TypeError('Use dates in YYYY-MM-DD format.') }
    const [, year, month, day] = parts.map(Number)
    const date = new Date(year, month - 1, day)
    if (year < 1000 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        throw new TypeError('Enter a valid calendar date.')
    }
    return date.getTime()
}

function termTest(token) {
    const colon = token.text.indexOf(':')
    const field = token.quote !== 0 && colon > 0 ? token.text.slice(0, colon).toLowerCase() : ''
    const value = normalize(field ? token.text.slice(colon + 1) : token.text)
    if (!value) { throw new TypeError(field ? `Add a value after ${field}:` : 'Enter a word inside the quotes.') }
    if (!field) {
        return (message) => documentFor(message, 'all').includes(value)
            || (message.labels ?? []).some((label) => normalize(label).includes(value))
    }
    if (TEXT_FIELDS.has(field)) {
        return (message) =>
            value === 'me' && ['from', 'to'].includes(field)
                ? field === 'from'
                    ? message.folder === 'sent'
                    : message.folder !== 'sent'
                : documentFor(message, field).includes(value)
    }
    if (field === 'after' || field === 'before') {
        const date = dateValue(value)
        return (message) => (field === 'after' ? Date.parse(message.timestamp) >= date : Date.parse(message.timestamp) < date)
    }
    if (field === 'is') {
        if (!['read', 'unread', 'starred'].includes(value)) { throw new TypeError('Use is:read, is:unread, or is:starred.') }
        return (message) => (value === 'starred' ? message.status.starred : value === 'read' ? message.status.read : !message.status.read)
    }
    if (field === 'has') {
        if (!['photo', 'image', 'attachment'].includes(value)) { throw new TypeError('Use has:photo or has:attachment.') }
        return (message) => (value === 'attachment' ? Boolean(message.attachments?.length) : documentFor(message, 'photo'))
    }
    // Labels can change without replacing the message, so do not cache them with immutable text.
    if (field === 'label') { return (message) => (message.labels ?? []).some((label) => normalize(label) === value) }
    if (field === 'category') {
        if (!CATEGORIES.includes(value)) { throw new TypeError('Use category:primary, projects, articles, or updates.') }
        return (message, folder) => mailboxFolder(message, folder) === value
    }
    if (field === 'in') {
        if (!['inbox', 'sent', 'all', 'allmail', 'archive', 'spam', 'trash', ...CATEGORIES].includes(value)) {
            throw new TypeError('Use in:inbox, in:sent, in:all, in:archive, in:spam, in:trash, or a tab name. Search stays in the current view.')
        }
        if (value === 'archive') { return message => message.mailboxArchived === true }
        return (message, folder) =>
            value === 'all' || value === 'allmail'
                ? isAllMailMessage(message, folder)
                : value === 'inbox'
                    ? CATEGORIES.includes(mailboxFolder(message, folder))
                    : mailboxFolder(message, folder) === value
    }
    throw new TypeError(`Unknown search operator: ${field}:`)
}

function tokenize(query) {
    const tokens = []
    let position = 0
    while (position < query.length) {
        if (/\s/.test(query[position])) {
            position++
            continue
        }
        if ('()-'.includes(query[position])) {
            tokens.push({ text: query[position++], symbol: true })
        } else {
            let text = ''
            let quote = -1
            while (position < query.length && !/[\s()]/.test(query[position])) {
                if (query[position] !== '"') {
                    text += query[position++]
                    continue
                }
                if (quote === -1) { quote = text.length }
                position++
                let closed = false
                while (position < query.length) {
                    const character = query[position++]
                    if (character === '"') {
                        closed = true
                        break
                    }
                    if (character === '\\' && ['"', '\\'].includes(query[position])) { text += query[position++] } else { text += character }
                }
                if (!closed) { throw new TypeError('Close the quoted phrase with another quotation mark.') }
            }
            tokens.push({ text, quote })
        }
        if (tokens.length > 100) { throw new TypeError('Use no more than 100 search terms and operators.') }
    }
    return tokens
}

export function compileSearch(query) {
    if (typeof query !== 'string' || query.length > 500) { throw new TypeError('Keep the search under 500 characters.') }
    const tokens = tokenize(query)
    let position = 0
    const at = (value) => tokens[position]?.text === value && (tokens[position].symbol || tokens[position].quote === -1)
    function atom(depth) {
        if (depth > 12) { throw new TypeError('Use fewer nested search groups.') }
        if (at('-')) {
            position++
            const test = atom(depth + 1)
            return (message, folder) => !test(message, folder)
        }
        if (at('(')) {
            position++
            const test = either(depth + 1)
            if (!at(')')) { throw new TypeError('Close the search group with a parenthesis.') }
            position++
            return test
        }
        if (!tokens[position] || at(')') || at('OR') || at('AND')) { throw new TypeError('Add a search term beside each operator or group.') }
        return termTest(tokens[position++])
    }
    function both(depth) {
        const tests = [atom(depth)]
        while (position < tokens.length && !at(')') && !at('OR')) {
            if (at('AND')) { position++ }
            tests.push(atom(depth))
        }
        return (message, folder) => tests.every((test) => test(message, folder))
    }
    function either(depth) {
        const tests = [both(depth)]
        while (at('OR')) {
            position++
            tests.push(both(depth))
        }
        return (message, folder) => tests.some((test) => test(message, folder))
    }
    if (!tokens.length) { return () => true }
    const test = either(0)
    if (position !== tokens.length) { throw new TypeError('Remove the extra closing parenthesis.') }
    return test
}

export function quoteSearch(value) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function buildSearchQuery({
    query = '',
    from = '',
    to = '',
    subject = '',
    exclude = '',
    after = '',
    before = '',
    status = '',
    photo = false,
}) {
    if (after && before && after >= before) { throw new TypeError('Before must be later than On or after.') }
    const filters = []
    for (const [field, value] of Object.entries({ from, to, subject })) {
        if (value.trim()) { filters.push(`${field}:${quoteSearch(value.trim())}`) }
    }
    if (exclude.trim()) { filters.push(`-${quoteSearch(exclude.trim())}`) }
    for (const [field, value] of Object.entries({ after, before })) { if (value) { filters.push(`${field}:${value}`) } }
    if (status) { filters.push(`is:${status}`) }
    if (photo) { filters.push('has:photo') }
    // Wrap an existing OR query so added filters constrain every branch.
    const base = query.trim()
    const result = [base && filters.length ? `(${base})` : base, ...filters].filter(Boolean).join(' ')
    compileSearch(result)
    return result
}

function mailboxFolder(message, folder) {
    return typeof folder === 'string' ? folder
        : message.mailboxFolder ?? (message.folder === 'inbox' ? message.category : message.folder)
}
