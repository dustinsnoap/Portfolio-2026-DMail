import { getState } from '../mailbox/state.js'
import { escapeHtml } from './content.js'
import { buildMessageContent, buildThreadEmail } from './thread-markup.js'

export function threadMessageWindow(messages, revealed = false) {
    return revealed || messages.length < 5 ? messages : [messages[0], ...messages.slice(-2)]
}

function historyMarkup(count) {
    return '<div class="thread-history"><button type="button" data-show-thread-history aria-expanded="false"' +
        ` aria-controls="thread-messages" aria-label="Show ${count} hidden messages" title="Show ${count} hidden messages">` +
        `${count}</button></div>`
}

export function buildThreadStack(messages, revealed = false, publicContent = false) {
    const visible = threadMessageWindow(messages, revealed)
    const hidden = messages.length - visible.length
    const ids = escapeHtml(JSON.stringify(messages.map(message => message.id)))
    return `<div class="thread-stack" id="thread-messages" data-message-ids="${ids}" data-history-revealed="${revealed}">` +
        visible.map((message, index) => buildThreadEmail(message, message === messages.at(-1)) +
            (index === 0 && hidden ? historyMarkup(hidden) : '')).join('') + '</div>' + (publicContent ? publicArchive(messages) : '')
}

// Keep all authored text in public HTML so crawlers can read collapsed history.
function publicArchive(messages) {
    const articles = messages.slice(0, -1).map(message =>
        `<article><h2>${escapeHtml(message.data.subject)}</h2><time datetime="${escapeHtml(message.timestamp)}"></time>` +
        buildMessageContent(message) + '</article>').join('')
    return articles ? `<section class="public-archive" hidden>${articles}</section>` : ''
}

function missingPreviews(messages, visible, existing) {
    const template = document.createElement('template')
    template.innerHTML = messages.filter(message => visible.has(message.id) && !existing.has(message.id))
        .map(message => buildThreadEmail(message, message === messages.at(-1))).join('')
    return new Map([...template.content.children].map(node => [node.dataset.id, node]))
}

function reconcileMessages(stack, messages, visible) {
    const existing = new Map([...stack.querySelectorAll(':scope > .message')].map(node => [node.dataset.id, node]))
    for (const [id, node] of existing) {
        if (visible.has(id)) { continue }
        node.remove()
        existing.delete(id)
    }
    const missing = missingPreviews(messages, visible, existing)
    let anchor = null
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        if (!visible.has(message.id)) { continue }
        let node = existing.get(message.id)
        if (!node) {
            node = missing.get(message.id)
            existing.set(message.id, node)
        }
        let next = node.nextElementSibling
        if (next?.classList.contains('thread-history')) { next = next.nextElementSibling }
        if (node.parentElement !== stack || next !== anchor) { stack.insertBefore(node, anchor) }
        anchor = node
    }
    return existing
}

// Do not collapse manually opened or focused messages when a new turn arrives.
function visibleMessageIds(stack, messages) {
    const ids = new Set(threadMessageWindow(messages, stack.dataset.historyRevealed === 'true').map(message => message.id))
    for (const node of stack.querySelectorAll(':scope > .message')) {
        if (node.dataset.autoExpanded === 'true' && node.dataset.id !== messages.at(-1).id) {
            node.classList.add('collapsed')
            delete node.dataset.autoExpanded
        }
        if (!node.classList.contains('collapsed') || node.contains(document.activeElement)) { ids.add(node.dataset.id) }
    }
    return ids
}

function updateDisclosure(stack, count) {
    let separator = stack.querySelector(':scope > .thread-history')
    if (!count) { separator?.remove(); return }
    if (!separator) {
        stack.querySelector(':scope > .message').insertAdjacentHTML('afterend', historyMarkup(count))
        separator = stack.querySelector(':scope > .thread-history')
    }
    const button = separator.querySelector('button')
    button.textContent = String(count)
    button.setAttribute('aria-label', `Show ${count} hidden messages`)
    button.title = `Show ${count} hidden messages`
}

export function expandThreadHistory(button) {
    const stack = button.closest('.thread-stack')
    const mail = stack.closest('.mail')
    const messages = getState().threads[mail.dataset.threadId]?.messages
    if (!messages) { return }
    const position = mail.querySelector('.thread').scrollTop
    const previous = new Set([...stack.querySelectorAll(':scope > .message')].map(node => node.dataset.id))
    if (stack.nextElementSibling?.classList.contains('public-archive')) { stack.nextElementSibling.remove() }
    stack.dataset.historyRevealed = 'true'
    const nodes = reconcileMessages(stack, messages, new Set(messages.map(message => message.id)))
    updateDisclosure(stack, 0)
    const first = messages.find(message => !previous.has(message.id))
    const focus = nodes.get(first?.id)
    focus?.setAttribute('tabindex', '-1')
    focus?.focus({ preventScroll: true })
    mail.querySelector('.thread').scrollTop = position
    document.dispatchEvent(new CustomEvent('dmail:thread-render'))
}

export function syncThreadStack(stack, messages) {
    const known = new Set(JSON.parse(stack.dataset.messageIds))
    const added = messages.filter(message => !known.has(message.id)).length
    if (!added) { return 0 }
    const nodes = reconcileMessages(stack, messages, visibleMessageIds(stack, messages))
    updateDisclosure(stack, messages.length - nodes.size)
    stack.dataset.messageIds = JSON.stringify(messages.map(message => message.id))
    return added
}
