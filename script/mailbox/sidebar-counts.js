import { isAllMailMessage } from '../search/search.js'
import { CATEGORIES, getState } from './state.js'

let cached

export function formatSidebarCount(count) {
    return count === 0 ? '' : count >= 100 ? '99+' : String(count)
}

export function countSidebarFolders({ index, threads }) {
    const counts = Object.fromEntries(Object.entries(index).map(([folder, ids]) => [folder, ids.length]))
    counts.inbox = new Set(CATEGORIES.flatMap(category => index[category])).size
    counts.starred = index.all.reduce((total, id) => total + Number(threads[id].messages.some(
        message => message.status.starred && isAllMailMessage(message),
    )), 0)
    return counts
}

export function renderSidebarCounts() {
    const state = getState()
    if (cached?.state !== state || cached.version !== state.summaryVersion) {
        cached = { state, version: state.summaryVersion, counts: countSidebarFolders(state) }
    }
    const { counts } = cached
    for (const button of document.querySelectorAll('.sidebar [data-folder]')) {
        const folder = button.dataset.folder === 'primary' && !button.hasAttribute('data-mobile-category')
            ? 'inbox' : button.dataset.folder
        updateSidebarBadge(button, counts[folder] ?? 0)
    }
}

function updateSidebarBadge(button, count) {
    let badge = button.querySelector('.unread-count')
    if (!badge) {
        badge = document.createElement('span')
        badge.className = 'unread-count'
        badge.setAttribute('aria-hidden', 'true')
        button.append(badge)
    }
    const text = formatSidebarCount(count)
    const description = `${count} ${count === 1 ? 'conversation' : 'conversations'}`
    if (badge.textContent !== text) { badge.textContent = text }
    if (badge.hidden !== (count === 0)) { badge.hidden = count === 0 }
    if (badge.title !== description) { badge.title = description }
    if (button.getAttribute('aria-description') !== description) { button.setAttribute('aria-description', description) }
}
