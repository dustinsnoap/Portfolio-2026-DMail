import { portfolioAvatar } from '../account/account-avatar.js'
import { attachmentCards } from '../messages/attachments.js'
import { escapeHtml } from '../messages/content.js'
import { threadSyncIndicator } from '../messages/message-sync.js'
import { buildThreadStack, syncThreadStack } from '../messages/thread-history.js'
import { buildMessageContent, buildThreadFooter, buildThreadHeader } from '../messages/thread-markup.js'
import { timestampMarkup } from '../messages/timestamps.js'
import { publicPageForPath, publicPageForThread } from '../navigation/conversation-links.js'
import { loadPreferences } from '../settings/preferences.js'
import { ensureBodies, hasDeferredBodies } from '../storage/message-bodies.js'
import { labelAppearance, threadLabels } from './labels.js'
import { saveConversationRead } from './mailbox-status.js'
import { renderSidebarCounts } from './sidebar-counts.js'
import { conversationUnread, getScopedThreads, getState, getVisiblePage } from './state.js'

const listMarkup = new WeakMap()

export function renderEmailList(notice = '') {
    const page = getVisiblePage()
    renderListStatus(page)
    renderPageControls(page)
    renderPageRows(page, notice)
    renderSelection()
    renderSidebarCounts()
    document.dispatchEvent(new CustomEvent('dmail:list-render'))
}

function renderListStatus({ total }) {
    const { search, activeCategory, activeLabel } = getState()
    const scope = activeCategory === 'all' ? 'All Mail' : activeCategory[0].toUpperCase() + activeCategory.slice(1)
    const status = document.querySelector('.search-status')
    status.hidden = !search.query.trim() && !search.error && !activeLabel
    const label = activeLabel ? ` · ${activeLabel}` : ''
    status.textContent = search.error || `${total} of ${getScopedThreads().length} conversations in ${scope}${label}`
    status.classList.toggle('search-error', Boolean(search.error))
    document.querySelector('.search-scope').textContent =
        activeCategory === 'all'
            ? 'Search across tabs and sent messages. Drafts, Spam, and Trash are excluded.'
            : `Search only in ${scope}. Choose All Mail in the sidebar to search across tabs and sent messages.`
    document.querySelector('.searchbox').setAttribute('aria-invalid', String(Boolean(search.error)))
}

function renderPageControls({ start, threads, total, page, lastPage }) {
    document.querySelector('.message-count').textContent = total ? `${start + 1}–${start + threads.length} of ${total}` : '0 of 0'
    for (const direction of ['prev', 'next']) {
        const button = document.querySelector(`.top-bar .page.${direction}`)
        button.disabled = direction === 'prev' ? page === 0 : page === lastPage
        button.classList.toggle('active', !button.disabled)
        button.setAttribute('aria-label', direction === 'prev' ? 'Previous page' : 'Next page')
    }
}

// Skip identical markup to preserve selection and mounted row controls.
function renderPageRows({ threads }, notice) {
    const { search } = getState()
    const preferences = readLabelPreferences()
    const empty = search.query.trim() ? 'No conversations match in this view. Try fewer terms or choose All Mail.' : 'No conversations in this view.'
    const list = document.querySelector('.email-list')
    const markup =
        (notice ? `<p class="storage-notice" role="status">${escapeHtml(notice)}</p>` : '') +
        threads.map((thread) => buildEmailRow(thread.latest, thread.messages.length, preferences)).join('') +
        (!threads.length && !search.error ? `<p class="search-empty">${empty}</p>` : '')
    if (listMarkup.get(list) === markup) { return }
    list.innerHTML = markup
    listMarkup.set(list, markup)
}

function readLabelPreferences() {
    try {
        return loadPreferences()
    } catch {
        return {}
    }
}

export function renderMessageLabels() {
    const { emails, threads } = getState()
    const preferences = readLabelPreferences()
    for (const row of document.querySelectorAll('.email-list .email')) {
        row.querySelector('.row-labels').innerHTML = labelChips(threadLabels(threads[emails[row.dataset.id].threadId]), preferences)
    }
    const mail = document.querySelector('.mail')
    const labels = mail.querySelector('.thread-labels')
    if (labels && threads[mail.dataset.threadId]) { labels.innerHTML = buildThreadLabels(mail.dataset.threadId, preferences) }
}

function buildThreadLabels(threadId, preferences) {
    const { activeCategory, threads } = getState()
    const folders = { archive: 'Archived', drafts: 'Draft', trash: 'Trash', spam: 'Spam', sent: 'Sent', all: 'All Mail', starred: 'Starred' }
    const folder = folders[threads[threadId].mailboxFolder] ?? folders[activeCategory] ?? 'Inbox'
    return `<span class="label">${folder}</span>` + labelChips(threadLabels(threads[threadId]), preferences, threadId)
}

export function renderSelection() {
    const { selected } = getState()
    let selectedCount = 0
    const rows = document.querySelectorAll('.email-list .email')
    for (const row of rows) {
        const checked = selected.has(row.dataset.id)
        if (checked) { selectedCount++ }
        if (row.classList.contains('selected') !== checked) { row.classList.toggle('selected', checked) }
        const checkbox = row.querySelector('.checkbox')
        if (checkbox.classList.contains('selected') !== checked) { checkbox.classList.toggle('selected', checked) }
        if (checkbox.getAttribute('aria-pressed') !== String(checked)) { checkbox.setAttribute('aria-pressed', String(checked)) }
        const avatar = row.querySelector('.mobile-avatar')
        if (avatar.getAttribute('aria-pressed') !== String(checked)) { avatar.setAttribute('aria-pressed', String(checked)) }
        const use = checkbox.querySelector('use')
        const href = `/api/portfolio/assets/img/sprites.svg#icon-checkbox-${checked ? 'active' : 'inactive'}`
        if (use.getAttribute('href') !== href) { use.setAttribute('href', href) }
    }

    const hasSelection = selected.size > 0
    const topBar = document.querySelector('.top-bar')
    topBar.classList.toggle('has-selection', hasSelection)
    document.dispatchEvent(new CustomEvent('dmail:selection-change'))
    topBar.querySelector('.options.unselected').inert = hasSelection
    topBar.querySelector('.options.selected').inert = !hasSelection
    const icon = selectedCount === 0 ? 'inactive' : selectedCount === rows.length ? 'active' : 'semiactive'
    topBar.querySelector('.bulk-select .box use').setAttribute('href', `/api/portfolio/assets/img/sprites.svg#icon-checkbox-${icon}`)
    topBar.querySelector('.bulk-select').setAttribute('aria-pressed', selectedCount === 0 ? 'false' : icon === 'active' ? 'true' : 'mixed')
}

export function renderStars() {
    const { emails } = getState()
    for (const item of document.querySelectorAll('.email-list .email, .mail .message')) {
        const star = item.querySelector('.star')
        star.classList.toggle('starred', emails[item.dataset.id].status.starred)
        star.setAttribute('aria-pressed', String(emails[item.dataset.id].status.starred))
    }
    renderSidebarCounts()
}

export function renderThread(threadId) {
    const { threads } = getState()
    if (!threads[threadId] || threads[threadId].mailboxFolder === 'hidden') { return }
    const mail = document.querySelector('.mail')
    const thread = threads[threadId].messages
    const revealed = mail.dataset.threadId === threadId && mail.classList.contains('visible')
        && mail.querySelector('.thread-stack')?.dataset.historyRevealed === 'true'
    mail.dataset.threadId = threadId

    const subject = thread[0]?.data.subject ?? ''
    const preferences = readLabelPreferences()

    mail.innerHTML = `
        ${buildThreadHeader(threads[threadId].mailboxFolder)}
        <div class="thread">
            <div class="thread-heading">
                <h1 class="thread-subject">${escapeHtml(subject)}</h1>
                <span data-thread-sync-status="${escapeHtml(threadId)}">${threadSyncIndicator(thread)}</span>
                <div class="thread-labels">${buildThreadLabels(threadId, preferences)}</div>
                <span class="label-error" role="alert"></span>
            </div>
            ${buildThreadStack(thread, revealed, publicPageForPath(location.pathname)?.[1] === threadId)}
            ${buildThreadFooter()}
        </div>`
    document.dispatchEvent(new CustomEvent('dmail:thread-render'))
}

export function renderExpandedMessage(message) {
    if (message.dataset.bodyReady === 'true') { return }
    const email = getState().emails[message.dataset.id]
    message.querySelector('.message-body').insertAdjacentHTML('beforeend', buildMessageContent(email))
    message.querySelector('.message-attachments').innerHTML = attachmentCards(email.attachments)
    message.dataset.bodyReady = 'true'
}

export function buildEmailRow(email, threadCount, preferences) {
    const { selected } = getState()
    const isSelected = selected.has(email.id)
    const page = publicPageForThread(email.threadId)
    const subject = page
        ? `<a class="title" href="${page[0]}" data-public-link>${escapeHtml(email.data.subject)}</a>`
        : `<span class="title">${escapeHtml(email.data.subject)}</span>`
    const count = threadCount > 1 ? ` <span class="thread-count">${threadCount}</span>` : ''
    return `
        <div class="email${conversationUnread(getState().threads[email.threadId]) ? ' unread' : ''}${isSelected ? ' selected' : ''}"
            data-id="${escapeHtml(
            email.id,
        )}" tabindex="0" role="group" aria-label="${escapeHtml(`${email.from.name}: ${email.data.subject}`)}">
            <button type="button" class="mobile-avatar" aria-label="Select conversation from ${escapeHtml(email.from.name)}" aria-pressed="${
                isSelected
            }">
                <span>${escapeHtml(email.from.name[0] ?? '?')}</span>
                ${email.from.avatar ? `<img src="${escapeHtml(portfolioAvatar(email.from.avatar))}" alt="" loading="lazy" decoding="async">` : ''}
            </button>
            <button type="button" class="checkbox icon${isSelected ? ' selected' : ''}" aria-label="Select conversation" aria-pressed="${isSelected}">
                <svg><use href="/api/portfolio/assets/img/sprites.svg#icon-checkbox-${isSelected ? 'active' : 'inactive'}" /></svg>
            </button>
            <button type="button" class="star icon${email.status.starred ? ' starred' : ''}" aria-label="Star conversation" aria-pressed="${
                email.status.starred
            }">
                <svg class="inactive"><use href="/api/portfolio/assets/img/sprites.svg#icon-star-inactive" /></svg>
                <svg class="active"><use href="/api/portfolio/assets/img/sprites.svg#icon-star-active" /></svg>
            </button>
            <span class="name">${escapeHtml(email.from.name)}${count}</span>
            <div class="title-summary">
                <span class="row-labels">${labelChips(threadLabels(getState().threads[email.threadId]), preferences)}</span>
                ${threadSyncIndicator(getState().threads[email.threadId].messages)}
                ${subject}
                <span class="summary">${escapeHtml(email.data.summary)}</span>
            </div>
            ${
                getState().threads[email.threadId].messages.some((message) => message.attachments?.length)
                    ? '<span class="attachment-indicator" aria-label="Has attachments" title="Has attachments">📎</span>'
                    : ''
            }
            ${timestampMarkup(email.timestamp)}
        </div>`
}

function labelChips(labels, preferences, threadId = '') {
    const visible = labels.filter((label) => labelAppearance(label, preferences).messages)
    const shown = threadId ? visible : visible.slice(0, 3)
    return (
        shown
            .map((label) => {
                const color = labelAppearance(label, preferences)
                return `<span class="topic-label" style="--label-background:${color.background};--label-text:${color.text}" title="${escapeHtml(
                    label,
                )}"><button type="button" class="label-link" data-label-filter="${escapeHtml(label)}"
                    aria-label="Show all conversations labeled ${escapeHtml(label)}">${escapeHtml(label)}</button>${
                    threadId
                        ? `<button type="button" class="remove-thread-label" data-label="${escapeHtml(label)}" aria-label="Remove ${escapeHtml(
                              label,
                          )} from this conversation">×</button>`
                        : ''
                }</span>`
            })
            .join('') +
        (!threadId && visible.length > shown.length
            ? `<span class="label-overflow" title="${escapeHtml(visible.slice(shown.length).join(', '))}">+${visible.length - shown.length}</span>`
            : '')
    )
}

export async function updateOpenThread() {
    const mail = document.querySelector('.mail')
    if (!mail?.classList.contains('visible')) { return 0 }
    const thread = getState().threads[mail.dataset.threadId]
    const stack = mail.querySelector('.thread-stack')
    if (!thread || thread.mailboxFolder === 'hidden' || !stack) { return 0 }
    if (hasDeferredBodies(thread.messages)) {
        try { await ensureBodies(thread.messages) } catch { return 0 }
        if (!stack.isConnected || getState().threads[mail.dataset.threadId] !== thread) { return 0 }
    }
    const scroller = mail.querySelector('.thread')
    const position = scroller.scrollTop
    const atBottom = scroller.scrollHeight - position - scroller.clientHeight < 48
    const added = syncThreadStack(stack, thread.messages)
    if (!added) { return 0 }
    try { saveConversationRead([mail.dataset.threadId], true) } catch { }
    if (atBottom && !mail.querySelector('.reply-form')) { scroller.scrollTop = scroller.scrollHeight } else { scroller.scrollTop = position }
    document.dispatchEvent(new CustomEvent('dmail:thread-render'))
    return added
}
