// Exploration counts actual openings, not messages marked read.
export function summarizeReadingProgress(emails, available, opened, threads) {
    const conversations = new Map()
    for (const email of Object.values(emails)) {
        if (!available.has(email.id) || email.status.deleted
            || !['primary', 'projects', 'articles', 'updates', 'inbox'].includes(email.folder)) { continue }
        const thread = threads[email.threadId]
        if (!thread || ['hidden', 'spam', 'trash', 'deleted'].includes(thread.mailboxFolder)) { continue }
        const conversation = conversations.get(email.threadId) ?? { id: email.threadId, primary: email.folder === 'primary', opened: false }
        conversation.opened ||= Object.hasOwn(opened, email.id)
        conversations.set(email.threadId, conversation)
    }
    const remaining = [...conversations.values()].filter(conversation => !conversation.opened)
    return { explored: conversations.size - remaining.length, total: conversations.size,
        next: (remaining.find(conversation => conversation.primary) ?? remaining[0])?.id ?? '' }
}

export function initReadingProgress({ read, open }) {
    const button = document.querySelector('.reading-progress')
    const bar = button.querySelector('[role="progressbar"]')
    const usage = button.querySelector('.usage')
    const label = button.querySelector('.text')

    function render() {
        const { explored, total, next } = read()
        const text = `${explored} of ${total} conversations explored`
        const percent = total ? Math.round(explored / total * 100) : 0
        if (label.textContent !== text) { label.textContent = text }
        if (bar.getAttribute('aria-valuenow') !== String(percent)) { bar.setAttribute('aria-valuenow', String(percent)) }
        if (bar.getAttribute('aria-valuetext') !== text) { bar.setAttribute('aria-valuetext', text) }
        if (usage.style.width !== `${percent}%`) { usage.style.width = `${percent}%` }
        button.disabled = !next
        button.title = !total ? 'No portfolio conversations available'
            : next ? 'Open the next unexplored conversation' : 'You have explored every available conversation'
    }

    button.addEventListener('click', () => {
        const { next } = read()
        if (next) { open(next) }
    })
    document.addEventListener('dmail:list-render', render)
    document.addEventListener('dmail:reading-progress', render)
    render()
}
