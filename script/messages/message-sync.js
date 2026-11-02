import { spriteIcon } from '../app/icons.js'
import { getState } from '../mailbox/state.js'
import { retryPendingMessages, startMessageSync, stopMessageSync } from '../storage/persistence.js'
import { escapeHtml } from './content.js'

export function syncIndicator(message) {
    if (!['pending', 'failed'].includes(message?.sync?.state)) { return '' }
    const pending = message.sync.state === 'pending'
    const label = pending ? 'Syncing message to server' : 'Not synced to server. Retry syncing messages'
    const title = pending ? label : `${label}. ${message.sync.error || 'Your message is saved in this browser.'}`
    return `<button type="button" class="message-sync ${pending ? 'syncing' : 'unsynced'}" data-retry-sync
        aria-label="${label}" title="${escapeHtml(title)}" ${pending ? 'disabled' : ''}>
        ${spriteIcon('sync-warning')}</button>`
}

export function threadSyncIndicator(messages = []) {
    return syncIndicator(messages.find(message => message.sync?.state === 'failed') ?? messages.find(message => message.sync))
}

function refreshIndicators() {
    for (const indicator of document.querySelectorAll('[data-thread-sync-status]')) {
        indicator.innerHTML = threadSyncIndicator(getState().threads[indicator.dataset.threadSyncStatus]?.messages)
    }
    for (const indicator of document.querySelectorAll('[data-sync-status]')) {
        indicator.innerHTML = syncIndicator(getState().emails[indicator.dataset.syncStatus])
    }
}

export function initMessageSync(onChange) {
    function refresh() { onChange(); refreshIndicators() }
    // Handle retry clicks before mailbox navigation treats them as opening the thread.
    function retry(event) {
        if (!event.target.closest('[data-retry-sync]')) { return }
        event.preventDefault()
        event.stopPropagation()
        void retryPendingMessages()
    }
    document.addEventListener('click', retry, true)
    document.addEventListener('dmail:message-sync', refresh)
    document.addEventListener('dmail:mailbox-data', startMessageSync)
    window.addEventListener('online', retryPendingMessages)
    startMessageSync()
    function stop() {
        stopMessageSync()
        document.removeEventListener('click', retry, true)
        document.removeEventListener('dmail:message-sync', refresh)
        document.removeEventListener('dmail:mailbox-data', startMessageSync)
        window.removeEventListener('online', retryPendingMessages)
    }
    return { stop }
}

export function sentSyncNotice(message) {
    if (message?.sync?.state === 'failed') { return 'Message saved in this browser. Not synced to the server.' }
    if (message?.sync?.state === 'pending') { return 'Message saved in this browser. Syncing to the server…' }
    return message?.remote ? 'Message synced to the server.' : 'Message saved in this browser.'
}
