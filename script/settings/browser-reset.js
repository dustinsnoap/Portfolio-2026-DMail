import { OWNER_FIRST_NAME } from '../app/identity.js'
import { resetArchivedChoices } from '../mailbox/mailbox-folders.js'
import { clearAttachmentBlobs } from '../storage/attachment-storage.js'
import { apiJSON, getMessagingSession, messagingConfigured } from '../storage/portfolio-api.js'

const PROFILE_KEYS = [
    'smail_replies_v1', 'smail_messages_v1', 'dmail_stars_v1', 'dmail_read_v1',
    'dmail_delivery_v1', 'dmail_activity_v1', 'dmail_search_history_v1',
]

export function isAppAsset(value, origin) {
    const url = new URL(value, origin)
    const catalog = url.pathname === '/api/portfolio/assets/data/emails.json' || url.pathname === '/api/portfolio/assets/data/writing.json'
    return url.origin === origin && (/^\/(?:script|style|api\/portfolio\/assets)\//.test(url.pathname) || catalog)
}

function appFiles() {
    const assets = performance.getEntriesByType('resource').map(entry => entry.name).filter(url => isAppAsset(url, location.origin))
    return [...new Set([location.href, ...assets])]
}

async function refreshFile(url) {
    const response = await fetch(url, { cache: 'reload', credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
    if (!response.ok) { throw new Error('App files could not be refreshed. Try again when the connection is available.') }
    await response.arrayBuffer()
}

async function refreshAppFiles() {
    const files = appFiles()
    for (let offset = 0; offset < files.length; offset += 4) { await Promise.all(files.slice(offset, offset + 4).map(refreshFile)) }
}

async function clearAssetCaches() {
    if (!globalThis.caches) { return }
    const names = (await caches.keys()).filter(name => /^dmail-assets(?:-|$)/.test(name))
    await Promise.all(names.map(name => caches.delete(name)))
}

function clearProfile() {
    resetArchivedChoices()
    for (const key of PROFILE_KEYS) { localStorage.removeItem(key) }
}

export async function resetBrowser() {
    await refreshAppFiles()
    await clearAssetCaches()
    let saved
    try {
        signalReset('start')
        saved = new Map([...PROFILE_KEYS, 'dmail_folder_choices_v1'].map(key => [key, localStorage.getItem(key)]))
        const records = ['smail_replies_v1', 'smail_messages_v1'].flatMap(key => JSON.parse(saved.get(key) || '[]'))
        const files = new Set(records.flatMap(record => (record.attachments ?? []).map(file => file.id)))
        if (messagingConfigured()) { await apiJSON('/session/reset', {}) }
        await clearAttachmentBlobs(files, clearProfile)
    } catch (error) {
        // Abort the IndexedDB transaction if metadata deletion fails so attachment bytes roll back too.
        if (saved) {
            for (const [key, value] of saved) {
                if (value === null) { localStorage.removeItem(key) } else { localStorage.setItem(key, value) }
            }
        }
        // The server may have rotated the visitor even if its response was lost.
        if (messagingConfigured()) { await getMessagingSession(true).catch(() => {}) }
        signalReset('cancel')
        throw error
    }
    signalReset('done')
}

export function initBrowserReset(view) {
    let resetting = false
    async function handleReset(event) {
        const button = event.target.closest('[data-reset-browser]')
        if (!button || button.disabled || resetting) { return }
        const message = 'Reset this browser\'s mailbox? Saved messages, replies, attachments, stars, and opening progress will be erased. '
            + 'Archived emails return to their original inbox sections. Settings, labels, and Trash/Spam decisions stay. '
            + 'Permanently deleted conversations stay hidden. '
            + (messagingConfigured() ? `${OWNER_FIRST_NAME} keeps copies of messages you sent. ` : '') + 'Unsent drafts will close.'
        if (!confirm(message)) { return }
        const status = view.querySelector('.browser-reset-status')
        resetting = true
        button.disabled = true
        status.textContent = 'Refreshing app files and resetting your mailbox…'
        try {
            await resetBrowser()
            location.reload()
        } catch (error) {
            status.textContent = error.message
            button.disabled = false
            resetting = false
        }
    }
    view.addEventListener('click', handleReset)
}

const RESET_KEY = 'dmail_profile_reset_v1'
let lifecycle

function pause() {
    lifecycle.prepare()
    document.querySelector('.app').inert = true
}

function resume() {
    document.querySelector('.app').inert = false
    lifecycle.resume()
}

// Notify other tabs before deletion so they cannot restore the old mailbox.
export function signalReset(phase) {
    if (phase === 'start') { pause() }
    if (phase === 'cancel') { resume() }
    localStorage.setItem(RESET_KEY, JSON.stringify({ phase, id: crypto.randomUUID() }))
}

export function initResetLifecycle(callbacks) {
    lifecycle = callbacks
    function handleReset(event) {
        if (event.key !== RESET_KEY || !event.newValue) { return }
        try {
            const { phase } = JSON.parse(event.newValue)
            if (phase === 'start') { pause() }
            if (phase === 'cancel') { resume() }
            if (phase === 'done') { location.reload() }
        } catch { }
    }
    window.addEventListener('storage', handleReset)
}
