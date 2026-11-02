import { OWNER_NAME } from '../app/identity.js'
import { contentText, escapeHtml, normalizeContent } from './content.js'

export function parseRecipients(value = '') {
    if (typeof value !== 'string' || value.length > 5000) { throw new TypeError('Enter valid email addresses') }
    const addresses = value
        .split(/[,;\n]/)
        .map((email) => email.trim())
        .filter(Boolean)
    if (addresses.some((email) => email.length > 254 || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email))) {
        throw new TypeError('Enter valid email addresses separated by commas or semicolons')
    }
    return [...new Set(addresses)].map((email) => ({ name: email, email }))
}

export function normalizeMessageRecipients(source) {
    const recipients = {}
    for (const field of ['to', 'cc', 'bcc']) {
        const values = source?.[field]
        if (!Array.isArray(values) || values.some((value) => typeof value?.email !== 'string')) {
            throw new TypeError('Enter valid email addresses')
        }
        recipients[field] = parseRecipients(values.map((value) => value.email).join(','))
    }
    const addresses = Object.values(recipients).flat()
    if (!addresses.length || addresses.length > 50) { throw new TypeError('Add between 1 and 50 recipients') }
    return recipients
}

export function validateMessageIdentity(message) {
    if (
        !message ||
        typeof message.id !== 'string' ||
        !/^message-[\da-f-]{36}$/.test(message.id) ||
        message.threadId !== `thread-${message.id.slice(8)}` ||
        typeof message.timestamp !== 'string' ||
        !Number.isFinite(Date.parse(message.timestamp))
    ) {
        throw new TypeError('Message must contain a valid ID, conversation, and timestamp')
    }
}

export function normalizeMessageBody(message) {
    if (typeof message.data?.subject !== 'string' || message.data.subject.length > 200 || message.data.format !== 'rich') {
        throw new TypeError('Use a subject under 200 characters and a valid message')
    }
    const body = normalizeContent(message.data.body)
    const attachments = normalizeAttachments(message.attachments)
    if (!contentText(body).trim() && !attachments.length) { throw new TypeError('Write a message before sending') }
    return { body, attachments }
}

// Legacy saved replies used plain text instead of rich nodes.
export function normalizeReplyBody(reply) {
    let body = reply.data?.body
    const format = reply.data?.format
    const attachments = normalizeAttachments(reply.attachments)
    if (format === 'rich') { body = normalizeContent(body) }
    if (
        format === 'rich'
            ? !contentText(body).trim() && !attachments.length
            : format !== 'text' || typeof body !== 'string' || (!body.trim() && !attachments.length) || body.length > 10000
    ) {
        throw new TypeError('Write a reply between 1 and 10,000 characters')
    }
    return { body: format === 'text' ? body.trim() : body, attachments }
}

export const MAX_ATTACHMENT_BYTES = 50_000_000
export const MAX_ATTACHMENTS = 10

export function normalizeAttachments(items = []) {
    if (!Array.isArray(items) || items.length > MAX_ATTACHMENTS) { throw new TypeError('Use up to 10 attachments per message') }
    let total = 0
    const ids = new Set()
    return items.map((item) => {
        if (
            !item ||
            !/^file-[\w-]{16,64}$/.test(item.id) ||
            ids.has(item.id) ||
            typeof item.name !== 'string' ||
            !item.name.trim() ||
            new TextEncoder().encode(item.name).length > 200 ||
            /[\x00-\x1f\x7f/\\]/.test(item.name) ||
            !Number.isSafeInteger(item.size) ||
            item.size < 0 ||
            typeof item.type !== 'string' ||
            item.type.length > 100
        ) { throw new TypeError('Invalid attachment') }
        ids.add(item.id)
        total += item.size
        if (total > MAX_ATTACHMENT_BYTES) { throw new TypeError('Attachments must total 50 MB or less per message') }
        if (item.blob && (!(item.blob instanceof Blob) || item.blob.size !== item.size)) { throw new TypeError('Invalid attachment data') }
        return { id: item.id, name: item.name.trim(), size: item.size, type: item.type, ...(item.blob ? { blob: item.blob } : {}) }
    })
}

export function filesToAttachments(files) {
    return normalizeAttachments(
        Array.from(files, (file) => ({
            id: `file-${crypto.randomUUID()}`,
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream',
            blob: file,
        })),
    )
}

export function fileSize(bytes) {
    return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : bytes >= 1000 ? `${Math.ceil(bytes / 1000)} KB` : `${bytes} B`
}

export function visitorSender(name = '') {
    if (typeof name !== 'string' || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
        throw new TypeError('Use a name of 80 characters or fewer without line breaks')
    }
    return { name: name.trim() || 'Me', email: '', avatar: '/api/portfolio/assets/img/me.jpg' }
}

export function buildSenderField(name = '') {
    return `<label class="message-sender"><span>From</span><input name="senderName" aria-label="Your name" maxlength="80"
        autocomplete="name" placeholder="Your name (optional)" value="${escapeHtml(name)}"></label>`
}

export const PORTFOLIO_OWNER = Object.freeze({ name: OWNER_NAME, email: 'owner@example.com' })

// Editable display names do not establish the portfolio owner's identity.
export function isPortfolioOwner(person) {
    return typeof person?.email === 'string' && person.email.toLowerCase() === PORTFOLIO_OWNER.email
}

export function contactLabel(person) {
    return isPortfolioOwner(person) ? PORTFOLIO_OWNER.name : person?.email || person?.name || ''
}
