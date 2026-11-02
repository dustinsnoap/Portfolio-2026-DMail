const AUTHORED_IDS = new Map([
    ['demo-introduction', '98f6b972-08f7-42eb-8564-a59dd43cf2cd'],
    ['demo-followup', 'e7ceea29-8e86-4cd6-9075-003694f108e6'],
    ['demo-norris', 'f319252b-f939-453d-b008-2caefb8058bc'],
    ['demo-draft', 'c88e90ea-b548-4fc4-bd82-52c9244d142e'],
    ['th-010', 'c7c9d166-0e0e-455d-b234-f2fb22aa5e48'],
    ['th-022', 'add68dcf-a1af-455c-83f1-1c79f5d8e9a8'],
    ['th-023', '2aa30c56-a159-42b1-b2ad-a53e964c24ff'],
])
const AUTHORED_THREADS = new Map([...AUTHORED_IDS].map(([thread, id]) => [id, thread]))
const OPAQUE_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[\w-]{32})$/i

// Public UUID aliases keep saved links stable without renaming authored message IDs.
export function conversationLinkId(thread) {
    if (AUTHORED_IDS.has(thread)) { return AUTHORED_IDS.get(thread) }
    const id = thread.startsWith('thread-') ? thread.slice(7) : ''
    return OPAQUE_ID.test(id) ? id : ''
}

// A URL never grants access; resolve it only against this visitor's loaded conversations.
export function resolveConversationLink(id, threads) {
    const thread = AUTHORED_THREADS.get(id) || (OPAQUE_ID.test(id) ? `thread-${id}` : id)
    return Object.hasOwn(threads, thread) ? thread : ''
}

export const PUBLIC_PAGES = [
    ['/projects/dmail', 'th-022', 'projects'],
    ['/writing/a-familiar-interface', 'th-023', 'articles'],
    ['/updates/portfolio', 'th-010', 'updates'],
]
export const PUBLIC_SECTIONS = [['/projects', '', 'projects'], ['/writing', '', 'articles'], ['/updates', '', 'updates']]

export function publicPageForPath(path) {
    const normalized = path.replace(/\/$/, '')
    return [...PUBLIC_PAGES, ...PUBLIC_SECTIONS, ['/about', '', 'primary']].find(([url]) => url === normalized)
}

export function publicPageForThread(thread) {
    return PUBLIC_PAGES.find(([, id]) => id === thread)
}

export function isMailboxPath(path) {
    return path === '/' || Boolean(publicPageForPath(path))
}

export function publicRoutePath({ thread, view, label, query, page: publicPage }) {
    if (publicPage === 'about' && !label && !query) { return '/about' }
    const page = thread ? publicPageForThread(thread) : PUBLIC_SECTIONS.find(([, , category]) => category === view)
    return page && page[2] === view && !label && !query ? page[0] : ''
}
