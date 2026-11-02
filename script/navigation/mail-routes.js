import { conversationLinkId, isMailboxPath, publicPageForPath, publicRoutePath } from './conversation-links.js'

const CATEGORIES = new Set(['projects', 'articles', 'updates'])
const FOLDERS = new Set(['inbox', 'sent', 'all', 'archive', 'starred', 'drafts', 'spam', 'trash'])

export function mailRoute({ view = 'primary', label = '', query = '', thread = '' }) {
    const scope = label ? `label/${encodeURIComponent(label)}` : CATEGORIES.has(view) ? `category/${view}`
        : view === 'primary' ? 'inbox' : FOLDERS.has(view) ? view : 'inbox'
    const token = conversationLinkId(thread)
    const id = token ? `/${token}` : ''
    return `#${scope}${id}${query ? `?q=${encodeURIComponent(query)}` : ''}`
}

export function parseMailRoute(hash) {
    if (!hash) { return null }
    try {
        const [path, search = ''] = hash.replace(/^#/, '').split('?')
        const parts = path.split('/').map(decodeURIComponent)
        let view = parts.shift()
        let label = ''
        if (view === 'label') {
            label = parts.shift() || ''
            if (!label.trim() || [...label].length > 40 || /[\x00-\x1f\x7f]/.test(label)) { return null }
            view = 'all'
        } else if (view === 'category') {
            view = parts.shift()
            if (!CATEGORIES.has(view)) { return null }
        } else if (!FOLDERS.has(view)) { return null }
        const thread = parts.shift() || ''
        if (parts.length || thread && !/^[\w-]{1,100}$/.test(thread)) { return null }
        const query = new URLSearchParams(search).get('q') || ''
        if (query.length > 2048) { return null }
        return { view: view === 'inbox' ? 'primary' : view, label, query, thread }
    } catch { return null }
}

export function initMailRoutes({ read, apply, historyOwner }) {
    let applying = false
    let lastAddress = ''
    let waiting = null
    let generation = 0

    // Consume temporary mobile history entries before committing a real mailbox route.
    function record({ replace = false } = {}) {
        if (applying || !isMailboxPath(location.pathname)) { return }
        const route = read()
        const hash = publicRoutePath(route) || `/${mailRoute(route)}`
        waiting = null
        if (hash === lastAddress && hash === location.pathname + location.hash) { return }
        lastAddress = hash
        historyOwner.commitRoute(hash, replace)
    }

    async function restore(route) {
        const ticket = ++generation
        waiting = null
        applying = true
        let result
        try { result = apply(route) } finally { applying = false }
        const restored = await result
        if (ticket !== generation) { return false }
        if (!restored) { waiting = route }
        return restored
    }

    async function navigate() {
        if (!isMailboxPath(location.pathname) || historyOwner.routePending()) { return }
        const address = location.pathname + location.hash
        if (address === lastAddress) { return }
        const page = publicPageForPath(location.pathname)
        const route = parseMailRoute(location.hash) || (page ? {
            view: page[2], thread: page[1], label: '', query: '', page: page[0] === '/about' ? 'about' : '',
        } : null)
        lastAddress = address
        const restored = await restore(route || { view: 'primary', label: '', query: '', thread: '' })
        if (lastAddress === address && (!route || restored)) { record({ replace: true }) }
    }

    // A shared conversation may arrive after account restoration or scheduled delivery.
    async function retry() {
        if (waiting && await restore(waiting)) { record({ replace: true }) }
    }

    window.addEventListener('popstate', navigate)
    window.addEventListener('hashchange', navigate)
    document.addEventListener('dmail:mailbox-data', retry)
    if (location.hash || publicPageForPath(location.pathname)) { navigate() } else { record({ replace: true }) }
    return { record, retry }
}
