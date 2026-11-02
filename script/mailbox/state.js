import { contentText } from '../messages/content.js'
import { normalizeAttachments,
    normalizeMessageBody, normalizeMessageRecipients, normalizeReplyBody, parseRecipients, PORTFOLIO_OWNER, validateMessageIdentity,
    visitorSender } from '../messages/message-model.js'
import { compileSearch, isAllMailMessage } from '../search/search.js'
import { hasLabel, normalizeLabels, threadLabels } from './labels.js'
import { buildFolderIndex, indexConversation, normalizeFolderChoices } from './mailbox-folders.js'

export const CATEGORIES = ['primary', 'projects', 'articles', 'updates']

export const PAGE_SIZE = 50

let state
let visibleThreads = null
const orderedScopes = new Map()

export function init({ emails }, folderChoices = {}) {
    if (!emails || typeof emails !== 'object' || Array.isArray(emails)) {
        throw new TypeError('Portfolio data must contain an emails object')
    }

    const choices = normalizeFolderChoices(folderChoices)
    const { emailMap, threads, index } = buildMailbox(emails, choices)
    visibleThreads = null
    orderedScopes.clear()
    state = {
        page: 0,
        summaryVersion: 0,
        emails: emailMap,
        threads,
        index,
        folderChoices: choices,
        activeCategory: 'primary',
        activeLabel: '',
        selected: new Set(),
        search: { query: '', error: '', test: compileSearch('') },
    }
}

function buildMailbox(emails, choices) {
    const emailMap = Object.create(null)
    const threads = Object.create(null)
    const folders = Object.fromEntries([...CATEGORIES, 'all', 'archive', 'drafts', 'sent', 'spam', 'trash', 'deleted'].map((key) => [key, new Set()]))

    for (const source of Object.values(emails)) {
        const email = normalizePortfolioEmail(source)
        emailMap[email.id] = email

        const thread = (threads[email.threadId] ??= { messages: [], latest: email, sent: false })
        thread.messages.push(email)
        thread.sent ||= email.folder === 'sent' && !email.status.deleted
        // Equal timestamps retain the original last-message representative.
        if (thread.latest.timestamp <= email.timestamp) { thread.latest = email }

        const folder = email.status.deleted ? 'deleted' : email.folder === 'inbox' ? email.category : email.folder
        folders[folder]?.add(email.threadId)
        if (isAllMailMessage(email)) { folders.all.add(email.threadId) }
    }

    for (const thread of Object.values(threads)) {
        thread.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    }

    const index = buildFolderIndex(threads, folders, choices)
    return { emailMap, threads, index }
}

function normalizePortfolioEmail(source) {
    return {
        ...source,
        from: { ...source.from, avatar: source.from.avatar?.replace(/^(?:\/|\.\/)?img\//, '/api/portfolio/assets/img/') },
        data: { ...source.data, summary: source.data.bodySource || source.remote?.bodyDeferred
            ? source.data.summary : summarize(source.data.body, source.data.format) },
        status: { ...source.status },
        labels: normalizeLabels(source.labels),
        attachments: normalizeAttachments(source.attachments),
    }
}

export function addPortfolioEmail(source) {
    if (state.emails[source.id]) { return state.emails[source.id] }
    return commitThreadMessage(normalizePortfolioEmail(source))
}

function commitThreadMessage(email) {
    appendThreadMessage(email)
    indexConversation(state.threads[email.threadId], state.index, state.folderChoices[email.threadId])
    invalidateView(false, true)
    return email
}

function appendThreadMessage(email) {
    state.emails[email.id] = email
    const thread = (state.threads[email.threadId] ??= { messages: [], latest: email, sent: false })
    const previousId = thread.latest.id
    thread.messages.push(email)
    thread.sent ||= email.folder === 'sent' && !email.status.deleted
    thread.messages.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    if (Date.parse(email.timestamp) >= Date.parse(thread.latest.timestamp)) { thread.latest = email }
    if (thread.latest.id !== previousId) { state.selected.delete(previousId) }
}

export function getState() {
    return state
}

export function refreshSearchResults() {
    invalidateView(false)
}

export function refreshCachedMailbox() {
    const cached = buildMailbox(state.emails, state.folderChoices)
    state.emails = cached.emailMap
    state.threads = cached.threads
    state.index = cached.index
    invalidateView(false, true)
    const visible = new Set(getVisibleThreads().map(thread => thread.latest.id))
    for (const id of state.selected) {
        if (!visible.has(id)) { state.selected.delete(id) }
    }
    getVisiblePage()
}

export function conversationUnread(thread) {
    return thread.messages.some(message => !message.status.read && !message.status.deleted)
}

export function setReadStatus(ids, read) {
    for (const id of ids) {
        if (state.emails[id]) { state.emails[id].status.read = read }
    }
    invalidateView()
    const visible = new Set(getVisibleThreads().map(thread => thread.latest.id))
    for (const id of state.selected) {
        if (!visible.has(id)) { state.selected.delete(id) }
    }
}

export function selectPageConversations(kind) {
    const tests = { all: () => true, none: () => false, read: thread => !conversationUnread(thread),
        unread: conversationUnread, starred: thread => thread.messages.some(message => message.status.starred),
        unstarred: thread => !thread.messages.some(message => message.status.starred),
    }
    if (!Object.hasOwn(tests, kind)) { return false }
    state.selected.clear()
    for (const thread of getVisiblePage().threads) {
        if (tests[kind](thread)) { state.selected.add(thread.latest.id) }
    }
    return true
}

export function getVisibleThreads() {
    if (visibleThreads) { return visibleThreads }
    const threads = state.search.error ? [] : orderedScope().filter(matchesView)
    visibleThreads = Object.freeze(threads)
    return visibleThreads
}

function orderedScope() {
    const category = state.activeCategory
    if (!orderedScopes.has(category)) {
        const threads = buildScopedThreads()
        if (['sent', 'all', 'archive', 'starred', 'spam', 'trash'].includes(category)) {
            threads.sort((a, b) => Date.parse(b.latest.timestamp) - Date.parse(a.latest.timestamp))
        }
        orderedScopes.set(category, Object.freeze(threads))
    }
    return orderedScopes.get(category)
}

function matchesView(thread) {
    if (state.activeLabel && !hasLabel(threadLabels(thread), state.activeLabel)) {
        return false
    }
    return !state.search.query.trim() || thread.messages.some(matchesSearch)
}

// Pass Sent separately so folder filtering does not replace the cached message object.
function matchesSearch(message) {
    const folder = message.mailboxFolder ?? message.folder
    const inFolder = ['drafts', 'spam', 'trash'].includes(state.activeCategory) && folder === state.activeCategory && !message.status.deleted
    const searchFolder = state.activeCategory === 'sent' && state.threads[message.threadId]?.sent ? 'sent' : undefined
    return (isAllMailMessage(message) || inFolder) && state.search.test(message, searchFolder)
}

function invalidateView(resetPage = false, refreshOrder = false) {
    visibleThreads = null
    if (resetPage) { state.page = 0 }
    if (refreshOrder) { orderedScopes.clear(); state.summaryVersion++ }
}

export function getVisiblePage() {
    const threads = getVisibleThreads()
    const lastPage = Math.max(0, Math.ceil(threads.length / PAGE_SIZE) - 1)
    state.page = Math.min(state.page, lastPage)
    const start = state.page * PAGE_SIZE
    return { threads: threads.slice(start, start + PAGE_SIZE), start, total: threads.length, page: state.page, lastPage }
}

export function setListPage(page) {
    const { lastPage } = getVisiblePage()
    const next = Math.max(0, Math.min(lastPage, Math.trunc(page)))
    if (!Number.isFinite(next) || next === state.page) { return false }
    state.page = next
    return true
}

export function showMessagePage(id) {
    const position = getVisibleThreads().findIndex((thread) => thread.latest.id === id)
    return position >= 0 && setListPage(Math.floor(position / PAGE_SIZE))
}

export function getScopedThreads() {
    return orderedScope()
}

function buildScopedThreads() {
    const ids = state.index[state.activeCategory === 'starred' ? 'all' : state.activeCategory]
    const threads = ids.map((id) => state.threads[id])
    return state.activeCategory === 'starred' ? threads.filter(isStarredThread) : threads
}

function isStarredThread(thread) {
    return thread.messages.some(message => message.status.starred && isAllMailMessage(message))
}

export function setActiveLabel(label = '') {
    state.activeLabel = label ? normalizeLabels([label])[0] : ''
    invalidateView(true)
    state.selected.clear()
}

export function setThreadLabels(threadId, labels) {
    const thread = state.threads[threadId]
    if (!thread) { return }
    const values = normalizeLabels(labels)
    if (thread.messages.every(message => message.labels.length === values.length
        && message.labels.every((label, index) => label === values[index]))) { return }
    state.summaryVersion++
    // Labels belong to the whole conversation, including future replies.
    for (const message of thread.messages) { message.labels = [...values] }
    invalidateView()
}

export function setSearchQuery(query) {
    if (query === state.search.query) { return false }
    invalidateView(true)
    state.search = { query, error: '', test: null }
    try {
        state.search.test = compileSearch(query)
    } catch (error) {
        state.search.error = error.message
    }
    state.selected.clear()
    return true
}

export function setActiveCategory(category) {
    if (!CATEGORIES.includes(category) || state.activeCategory === category) { return false }
    state.activeCategory = category
    invalidateView(true)
    state.selected.clear()
    return true
}

export function setActiveFolder(folder) {
    if (!['sent', 'all', 'archive', 'starred', 'drafts', 'spam', 'trash'].includes(folder)) { return false }
    if (state.activeCategory === folder) { return false }
    state.activeCategory = folder
    invalidateView(true)
    state.selected.clear()
    return true
}

export function toggleSelected(id) {
    if (state.selected.has(id)) { state.selected.delete(id) } else { state.selected.add(id) }
}

export function toggleSelectAll() {
    const ids = getVisiblePage().threads.map((thread) => thread.latest.id)
    const allSelected = ids.length > 0 && ids.every((id) => state.selected.has(id))
    state.selected.clear()
    if (!allSelected) { ids.forEach((id) => state.selected.add(id)) }
}

export function toggleStar(id) {
    const email = state.emails[id]
    if (!email) { return }
    email.status.starred = !email.status.starred
    state.summaryVersion++
    orderedScopes.delete('starred')
    invalidateView()
    if (state.search.query || state.activeCategory === 'starred') {
        const visible = new Set(getVisibleThreads().map((thread) => thread.latest.id))
        for (const selected of state.selected) {
            if (!visible.has(selected)) { state.selected.delete(selected) }
        }
    }
}

// All portfolio replies go to the owner, including replies to Sent and public visitor messages.
export function getReplyRecipient() {
    return PORTFOLIO_OWNER
}

export function createReply(messageId, body, attachments = [], senderName = '') {
    return normalizeReply({
        id: `reply-${crypto.randomUUID()}`,
        threadId: state.emails[messageId]?.threadId,
        replyTo: messageId,
        senderName,
        timestamp: new Date().toISOString(),
        data: { body, format: Array.isArray(body) ? 'rich' : 'text' },
        attachments,
    })
}

export { parseRecipients } from '../messages/message-model.js'

export function createMessage({ to, cc = '', bcc = '', subject = '', body, attachments = [], senderName = '' }) {
    const id = crypto.randomUUID()
    return normalizeMessage({
        id: `message-${id}`,
        threadId: `thread-${id}`,
        timestamp: new Date().toISOString(),
        senderName,
        recipients: { to: parseRecipients(to), cc: parseRecipients(cc), bcc: parseRecipients(bcc) },
        data: { subject, body, format: 'rich' },
        attachments,
    })
}

export function addMessage(source) {
    const message = normalizeMessage(source)
    if (state.emails[message.id]) { return state.emails[message.id] }
    return commitThreadMessage(message)
}

function normalizeMessage(message) {
    validateMessageIdentity(message)
    const recipients = normalizeMessageRecipients(message.recipients)
    const addresses = Object.values(recipients).flat()
    const { body, attachments } = normalizeMessageBody(message)
    const sender = visitorSender(message.senderName)
    return {
        id: message.id,
        remote: message.remote,
        sync: message.sync,
        senderEmail: message.senderEmail,
        threadId: message.threadId,
        timestamp: message.timestamp,
        folder: 'sent',
        senderName: sender.name,
        from: sender,
        to: { ...addresses[0] },
        recipients,
        attachments,
        labels: normalizeLabels(message.labels),
        data: { subject: message.data.subject.trim() || '(no subject)', body, format: 'rich', summary: summarize(body, 'rich') },
        status: { read: true, starred: false, deleted: false },
    }
}

export function addReply(reply) {
    const email = normalizeReply(reply)
    if (state.emails[email.id]) { return state.emails[email.id] }

    return commitThreadMessage(email)
}

function validateReplyReference(reply) {
    const message = state.emails[reply?.replyTo]
    if (
        !message ||
        reply.threadId !== message.threadId ||
        typeof reply.id !== 'string' ||
        !/^reply-[\da-f-]{36}$/.test(reply.id) ||
        typeof reply.timestamp !== 'string' ||
        !Number.isFinite(Date.parse(reply.timestamp))
    ) {
        throw new TypeError('Reply must reference an existing message and contain a valid ID and timestamp')
    }
    return message
}

function normalizeReply(reply) {
    const message = validateReplyReference(reply)
    const format = reply.data?.format
    const { body, attachments } = normalizeReplyBody(reply)
    const sender = visitorSender(reply.senderName)
    return {
        id: reply.id,
        remote: reply.remote,
        sync: reply.sync,
        senderEmail: reply.senderEmail,
        threadId: message.threadId,
        replyTo: message.id,
        folder: 'sent',
        timestamp: reply.timestamp,
        senderName: sender.name,
        from: sender,
        to: { ...getReplyRecipient() },
        attachments,
        labels: threadLabels(state.threads[message.threadId]),
        data: {
            subject: message.data.subject,
            body,
            format,
            summary: summarize(body, format),
        },
        status: { read: true, starred: false, deleted: false },
    }
}

export function summarize(body = '', format = 'html') {
    if (!body) { return '' }
    const text = format === 'rich' ? contentText(body) : format === 'text' ? body : body.replace(/<[^>]*>/g, '')
    return text.trim().slice(0, 150)
}

export function applyFolderChoices(choices) {
    state.folderChoices = normalizeFolderChoices(choices)
    for (const thread of Object.values(state.threads)) {
        indexConversation(thread, state.index, state.folderChoices[thread.latest.threadId], false)
    }
    state.selected.clear()
    invalidateView(false, true)
}
