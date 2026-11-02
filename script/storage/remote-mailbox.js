import { CHATBOT_NAME } from '../app/identity.js'
import { addPortfolioEmail, addReply, getState, init, summarize } from '../mailbox/state.js'
import { invalidateSearch } from '../search/search.js'
import { loadAttachmentBlob } from './attachment-storage.js'
import { apiJSON, apiRequest, getMessagingSession, listRemoteMessages, messagingConfigured } from './portfolio-api.js'

const deferred = new Map()
const localReplies = new Map()
const owned = new Set()
const restoredFiles = new WeakMap()
const serverRecords = new Set()
let revision = ''
let lastRefresh = 0
let settleUntil = 0

export async function restoreRemoteMailbox(shouldApply = () => true) {
    await getMessagingSession()
    if (!shouldApply()) { return 0 }
    restoreFileRoutes()
    const [mine, published] = await Promise.all([listRemoteMessages('mine', true), listRemoteMessages('public', true)])
    if (!shouldApply()) { return 0 }
    const changed = queueRemoteMessages(mine, published)
    lastRefresh = Date.now()
    return changed + flushRemoteMailbox()
}

// Reconcile periodically even without a new revision because list indexes may lag behind writes.
export async function pollRemoteMailbox(shouldApply = () => true) {
    if (!messagingConfigured()) { return 0 }
    await getMessagingSession()
    const status = await (await apiRequest('/messages/revision')).json()
    if (typeof status.revision !== 'string' || !status.revision) { throw new Error('Invalid mailbox revision') }
    if (!shouldApply()) { return 0 }
    const now = Date.now()
    if (status.revision === revision && now >= settleUntil && now - lastRefresh < 30000) {
        return flushRemoteMailbox()
    }
    if (status.revision !== revision) { settleUntil = now + 10000 }
    const changed = await restoreRemoteMailbox(shouldApply)
    if (shouldApply()) { revision = status.revision }
    return changed
}

function queueRemoteMessages(mine, published) {
    owned.clear()
    for (const message of mine) { owned.add(message.id) }
    const incoming = new Map([...published, ...mine].filter(item => /^(message|reply)-/.test(item.id)).map(item => [item.id, item]))
    const removed = new Set([...serverRecords].filter(id => !incoming.has(id) && getState().emails[id]))
    let changed = removeRemoteMessages(removed)
    serverRecords.clear()
    for (const item of incoming.values()) {
        serverRecords.add(item.id)
        const existing = getState().emails[item.id]
        if (!existing) { deferred.set(item.id, item) } else if (existing.remote && existing.remote.version !== item.version) {
            existing.remote = { ...existing.remote, version: item.version, visibility: item.visibility,
                bodyDeferred: Boolean(item.bodyDeferred) }
            existing.data = remoteMessage(item).data
            invalidateSearch(existing)
            changed++
        }
    }
    for (const id of deferred.keys()) { if (!incoming.has(id)) { deferred.delete(id) } }
    return changed
}

function removeRemoteMessages(removed) {
    if (!removed.size) { return 0 }
    const state = getState()
    const children = new Map()
    for (const message of Object.values(state.emails)) {
        if (!message.replyTo) { continue }
        if (!children.has(message.replyTo)) { children.set(message.replyTo, []) }
        children.get(message.replyTo).push(message)
    }
    for (const id of removed) {
        for (const message of children.get(id) ?? []) {
            if (removed.has(message.id)) { continue }
            removed.add(message.id)
            if (message.sync) { localReplies.set(message.id, message) }
        }
    }
    const emails = Object.fromEntries(Object.entries(state.emails).filter(([id]) => !removed.has(id)))
    const { activeCategory, activeLabel, search } = state
    init({ emails }, state.folderChoices)
    Object.assign(getState(), { activeCategory, activeLabel, search })
    return removed.size
}

function restoreFileRoutes() {
    for (const message of Object.values(getState().emails)) {
        const files = message.remote?.files
        if (!files || restoredFiles.get(message) === files) { continue }
        const types = new Map((message.attachments ?? []).map(file => [file.id, file.type]))
        for (const file of files) { registerRemoteFile(file.localId, message.id, file.id, types.get(file.localId)) }
        restoredFiles.set(message, files)
    }
}

// Keep local replies pending until their parent exists in this mailbox.
export function queueLocalReplies(replies) {
    localReplies.clear()
    for (const reply of replies) {
        if (!reply?.id || !reply.replyTo) {
            console.warn('Saved reply must identify its parent')
            continue
        }
        localReplies.set(reply.id, reply)
    }
}

export function flushRemoteMailbox() {
    let added = 0
    let changed = true
    while (changed) {
        changed = false
        for (const item of deferred.values()) {
            if (getState().emails[item.id]) { deferred.delete(item.id); continue }
            const parent = getState().emails[item.replyTo]
            if (item.replyTo && !parent) { continue }
            const category = parent && parent.folder !== 'sent' ? parent.category || parent.folder : 'primary'
            addPortfolioEmail(remoteMessage(item, owned.has(item.id), category))
            deferred.delete(item.id)
            changed = true
            added++
        }
        for (const [id, reply] of localReplies) {
            if (!getState().emails[reply.replyTo]) { continue }
            try {
                addReply(reply)
                added++
                changed = true
            } catch (error) {
                console.warn('Unable to restore saved reply', error)
            }
            localReplies.delete(id)
        }
    }
    return added
}

const uploads = new Map()
const photos = new Map()
const fileRoutes = new Map()
const submissions = new WeakMap()

// Reuse the submission ID after a lost response to avoid sending the same draft twice.
export function identifySubmission(record, draft) {
    const signature = JSON.stringify({ ...record, id: '', threadId: record.replyTo ? record.threadId : '', timestamp: '' })
    const earlier = submissions.get(draft)
    if (earlier?.signature === signature) {
        record.id = earlier.id
        if (!record.replyTo) { record.threadId = `thread-${record.id.slice(8)}` }
    } else { submissions.set(draft, { signature, id: record.id }) }
    return record
}

async function uploadAttachment(file, shouldApply) {
    if (!uploads.has(file.id)) {
        const bytes = file.blob ?? await loadAttachmentBlob(file.id).catch(() => loadRemoteFile(file.id))
        checkMailbox(shouldApply)
        const promise = apiRequest(`/files?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: bytes,
            timeout: 120000, headers: { 'Content-Type': 'application/octet-stream' } }).then(response => response.json())
        uploads.set(file.id, promise)
        promise.catch(() => { if (uploads.get(file.id) === promise) { uploads.delete(file.id) } })
    }
    return uploads.get(file.id)
}

async function uploadContent(nodes, shouldApply, staged) {
    const result = []
    for (const node of nodes) {
        if (typeof node === 'string') { result.push(node); continue }
        if (node.tag === 'img') {
            const index = staged.index++
            const photo = staged.photos[index] ?? await uploadPhoto(node.src, shouldApply)
            staged.photos[index] = { id: photo.id }
            result.push({ tag: 'img', photoId: photo.id, alt: node.alt })
        } else { result.push({ ...node, ...(node.children ? { children: await uploadContent(node.children, shouldApply, staged) } : {}) }) }
    }
    return result
}

async function uploadPhoto(src, shouldApply) {
    if (!photos.has(src)) {
        const promise = fetch(src).then(response => {
            if (!response.ok) { throw new Error('Could not read the inserted photo') }
            return response.blob()
        }).then(bytes => {
            checkMailbox(shouldApply)
            return apiRequest('/photos', { method: 'POST', body: bytes, headers: { 'Content-Type': bytes.type } })
        }).then(response => response.json())
        photos.set(src, promise)
        promise.catch(() => { if (photos.get(src) === promise) { photos.delete(src) } })
    }
    return photos.get(src)
}

export async function submitRemoteMessage(record, importing = false, shouldApply = () => true, onStaged = () => {}) {
    checkMailbox(shouldApply)
    const session = await getMessagingSession()
    if (record.sync?.accountId && record.sync.accountId !== session.accountId) {
        throw new Error('Sign in to the account that wrote this message before retrying.')
    }
    if (!importing && session.mailEnabled === false && !session.chatbotEnabled) {
        throw new Error('Message delivery is not configured yet. Please try again later.')
    }
    if (record.replyTo) { await ensureRemoteParent(record.replyTo, shouldApply) }
    checkMailbox(shouldApply)
    const assets = record.sync?.assets ?? { files: [], photos: [] }
    const staged = { photos: assets.photos, index: 0 }
    const attachments = []
    for (const file of record.attachments ?? []) {
        const saved = assets.files.find(upload => upload.localId === file.id)
        attachments.push(saved ?? await uploadAttachment(file, shouldApply))
    }
    const content = record.data.format === 'rich' ? await uploadContent(record.data.body, shouldApply, staged) : undefined
    if (record.sync) {
        record.sync.assets = { photos: staged.photos,
            files: attachments.map((file, index) => ({ localId: record.attachments[index].id, id: file.id })) }
    }
    checkMailbox(shouldApply)
    onStaged()
    const recipients = record.recipients ?? { to: [record.to], cc: [], bcc: [] }
    checkMailbox(shouldApply)
    const receipt = await apiJSON(importing ? '/messages/import' : '/messages', {
        id: record.id, replyTo: record.replyTo || '', name: record.senderName || '',
        email: record.senderEmail || '', ...recipients, attachments: attachments.map(file => file.id),
        data: { subject: record.data.subject, format: record.data.format,
            body: record.data.format === 'text' ? record.data.body : '', ...(content ? { content } : {}) } }, { Prefer: 'return=minimal' })
    checkMailbox(shouldApply)
    if (receipt.ok !== true && receipt.id !== record.id) { throw new Error('Invalid message acknowledgment') }
    record.remote = { id: record.id, visibility: receipt.visibility || 'pending', version: receipt.version || 1,
        files: attachments.map((file, index) => ({ localId: record.attachments[index].id, id: file.id })) }
    if (receipt.timestamp) { record.timestamp = receipt.timestamp }
    for (let index = 0; index < attachments.length; index++) {
        registerRemoteFile(record.attachments[index].id, record.id, attachments[index].id)
    }
    return receipt
}

// Import missing ancestors without replaying their historical email notifications.
async function ensureRemoteParent(id, shouldApply) {
    if (id.startsWith('em-')) { return }
    const parent = getState()?.emails[id]
    if (!parent || parent.remote) { return }
    if (parent.sync) { throw new Error('Sync the earlier message in this conversation before retrying.') }
    await submitRemoteMessage(parent, true, shouldApply)
}

export function registerRemoteFile(localId, messageId, fileId = localId, type = '') {
    fileRoutes.set(localId, { path: `/messages/${encodeURIComponent(messageId)}/files/${encodeURIComponent(fileId)}`, type })
}

export async function loadRemoteFile(id) {
    const route = fileRoutes.get(id)
    if (!route) { throw new Error('This attachment is no longer available in this browser.') }
    const bytes = await (await apiRequest(route.path, { timeout: 120000 })).blob()
    return new Blob([bytes], { type: route.type || bytes.type })
}

export function remoteMessage(message, owned = false, category = 'primary') {
    for (const file of message.attachments ?? []) { registerRemoteFile(file.id, message.id, file.id, file.type) }
    const body = message.data.format === 'rich' ? restorePhotos(message.data.content, message.id) : message.data.body
    const summary = message.bodyDeferred ? message.data.summary.trim().slice(0, 150) : summarize(body, message.data.format)
    return { ...message, folder: !owned && message.folder === 'sent' ? category : message.folder,
        to: message.to?.[0] ?? { name: 'you' },
        from: { ...message.from, ...(message.assistant ? { name: CHATBOT_NAME } : {}),
            avatar: message.assistant ? '/api/portfolio/assets/img/chatbot.jpg' : '/api/portfolio/assets/img/me.jpg' },
        recipients: { to: message.to ?? [], cc: message.cc ?? [], bcc: message.bcc ?? [] },
        data: { ...message.data, body, summary },
        remote: { id: message.id, visibility: message.visibility, version: message.version, bodyDeferred: Boolean(message.bodyDeferred) },
        status: { read: false, starred: false, deleted: false } }
}

// Rebuild photo URLs from authorized IDs; never accept a server-provided image URL.
function restorePhotos(nodes, messageId) {
    return (nodes ?? []).map(node => {
        if (typeof node === 'string') { return node }
        if (node.tag === 'img') {
            return { tag: 'img', alt: node.alt,
                src: `/api/portfolio/messages/${encodeURIComponent(messageId)}/photos/${encodeURIComponent(node.photoId)}` }
        }
        return { ...node, ...(node.children ? { children: restorePhotos(node.children, messageId) } : {}) }
    })
}

function checkMailbox(shouldApply) {
    if (!shouldApply()) { throw new Error('Mailbox changed before synchronization') }
}

export function resetRemoteUploads() {
    uploads.clear()
    photos.clear()
}
