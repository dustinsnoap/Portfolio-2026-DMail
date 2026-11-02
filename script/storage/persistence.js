import { ACCOUNT_CACHE_NOTICE, ACCOUNT_MARKER, accountCacheAvailable } from '../account/account-storage.js'
import { getState } from '../mailbox/state.js'
import { saveAttachmentBlobs } from './attachment-storage.js'
import { messagingConfigured } from './portfolio-api.js'
import { resetRemoteUploads, submitRemoteMessage } from './remote-mailbox.js'

const REPLIES_KEY = 'smail_replies_v1'
const MESSAGES_KEY = 'smail_messages_v1'
const pending = new Map()
let active = true
let epoch = 0
let writing = null

export async function loadReplies(storage = localStorage) { return loadRecords(REPLIES_KEY, storage) }

export async function loadMessages(storage = localStorage) { return loadRecords(MESSAGES_KEY, storage) }

export async function saveReply(reply, storage = localStorage) { return saveRecord(REPLIES_KEY, reply, storage) }

export async function saveMessage(message, storage = localStorage) { return saveRecord(MESSAGES_KEY, message, storage) }

// Malformed saved records may still be recoverable; reject them without overwriting their storage.
function loadRecords(key, storage) {
    const saved = storage.getItem(key)
    if (saved === null) { return [] }
    const records = JSON.parse(saved)
    if (!Array.isArray(records)) { throw new TypeError('Saved messages must be an array') }
    return records
}

function saveMetadata(key, record, storage) {
    const records = loadRecords(key, storage)
    const saved = { ...record, attachments: (record.attachments ?? []).map(({ blob, ...metadata }) => metadata) }
    const index = records.findIndex(value => value.id === record.id)
    if (index < 0) { records.push(saved) } else { records[index] = saved }
    storage.setItem(key, JSON.stringify(records))
}

// Persist the complete local message before exposing it or starting its network send.
async function saveRecord(key, record, storage) {
    if (storage === globalThis.localStorage && !accountCacheAvailable) { throw new Error(ACCOUNT_CACHE_NOTICE) }
    const remote = storage === globalThis.localStorage && messagingConfigured()
    if (remote) { record.sync = { state: 'pending', accountId: storage.getItem(ACCOUNT_MARKER) || '' } }
    await saveAttachmentBlobs(record.attachments)
    saveMetadata(key, record, storage)
    if (remote) {
        pending.set(record.id, { key, record, storage, epoch, account: storage.getItem(ACCOUNT_MARKER) || '' })
        void retryPendingMessages()
    }
}

// A late send must not restore data after reset, sign-out, or an account switch.
function current(job) {
    if (!active || job.epoch !== epoch) { return false }
    try {
        return (job.storage.getItem(ACCOUNT_MARKER) || '') === job.account &&
            loadRecords(job.key, job.storage).some(record => record.id === job.record.id)
    } catch { return false }
}

function report(job) {
    if (!current(job)) { return }
    const message = getState()?.emails[job.record.id]
    if (message) { Object.assign(message, { sync: job.record.sync, remote: job.record.remote, timestamp: job.record.timestamp }) }
    try { saveMetadata(job.key, job.record, job.storage) } catch (error) {
        console.warn('Could not update local message synchronization metadata', error)
    }
    globalThis.document?.dispatchEvent(new Event('dmail:message-sync'))
}

async function syncRecord(job) {
    if (!current(job)) { return }
    const accountId = job.record.sync?.accountId || job.account
    job.record.sync = { ...job.record.sync, state: 'pending', accountId, error: undefined }
    report(job)
    try {
        await submitRemoteMessage(job.record, false, () => current(job), () => saveMetadata(job.key, job.record, job.storage))
        if (!current(job)) { return }
        job.record.sync = undefined
        if (pending.get(job.record.id) === job) { pending.delete(job.record.id) }
    } catch (error) {
        if (!current(job)) { return }
        job.record.sync = { ...job.record.sync, state: 'failed', accountId, error: String(error.message).slice(0, 240) }
    }
    report(job)
}

// Serialize the outbox so a reply cannot overtake its locally queued parent.
export function retryPendingMessages() {
    if (!active) { return Promise.resolve() }
    if (writing) { return writing }
    const started = epoch
    const operation = async () => {
        for (const job of pending.values()) {
            if (!active || started !== epoch) { break }
            await syncRecord(job)
        }
    }
    writing = operation().finally(() => {
        writing = null
        if (active && [...pending.values()].some(job => current(job) && job.record.sync?.state === 'pending')) {
            void retryPendingMessages()
        }
    })
    return writing
}

export function startMessageSync() {
    active = true
    if (!messagingConfigured()) { return }
    for (const record of Object.values(getState()?.emails ?? {})) {
        if (!['pending', 'failed'].includes(record.sync?.state)) { continue }
        const key = record.replyTo ? REPLIES_KEY : MESSAGES_KEY
        const job = { key, record, storage: localStorage, epoch, account: localStorage.getItem(ACCOUNT_MARKER) || '' }
        if (current(job) && !pending.has(record.id)) { pending.set(record.id, job) }
    }
    void retryPendingMessages()
}

export function stopMessageSync() {
    active = false
    epoch++
    pending.clear()
    resetRemoteUploads()
}
