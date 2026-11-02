import { getState, refreshSearchResults } from '../mailbox/state.js'
import { invalidateSearch } from '../search/search.js'
import { apiRequest } from './portfolio-api.js'

const requests = new Map()
const privateRequests = new WeakMap()
let searchRequest

function authoredBodies(source) {
    if (!/^\/script\/content\/thread\.[a-f0-9]{16}\.json$/.test(source)) { throw new Error('Invalid authored body source') }
    if (!requests.has(source)) {
        const request = fetch(source, { signal: AbortSignal.timeout(15000) }).then(async response => {
            if (!response.ok) { throw new Error('Message content could not load. Please try again.') }
            return response.json()
        }).catch(error => { requests.delete(source); throw error })
        requests.set(source, request)
    }
    return requests.get(source)
}

async function ensureMessageBody(email) {
    const source = email.data.bodySource
    if (source) {
        const bodies = await authoredBodies(source)
        if (!Object.hasOwn(bodies, email.id)) { throw new Error('The message is missing from this release') }
        const body = bodies[email.id]
        if (email.data.format === 'rich' ? !Array.isArray(body) : typeof body !== 'string') { throw new Error('Invalid message body') }
        email.data.body = body
        delete email.data.bodySource
        invalidateSearch(email)
    }
    if (email.remote?.bodyDeferred && !privateRequests.has(email)) {
        const pending = loadRemoteBody(email).finally(() => privateRequests.delete(email))
        privateRequests.set(email, pending)
    }
    if (privateRequests.has(email)) { await privateRequests.get(email) }
}

async function loadRemoteBody(email) {
    const response = await apiRequest(`/messages/${encodeURIComponent(email.remote.id)}`)
    const message = await response.json()
    if (getState().emails[email.id] !== email) { throw new Error('Mailbox changed before content loaded') }
    if (message.id !== email.id || message.version !== email.remote.version) { throw new Error('This message changed. Refresh and try again.') }
    const { remoteMessage } = await import('./remote-mailbox.js')
    if (getState().emails[email.id] !== email) { throw new Error('Mailbox changed before content loaded') }
    email.data = remoteMessage(message).data
    delete email.remote.bodyDeferred
    invalidateSearch(email)
}

// Discard late body responses after an account or mailbox change.
export async function ensureBodies(emails = Object.values(getState().emails)) {
    let position = 0
    async function next() {
        while (position < emails.length) {
            const email = emails[position++]
            await ensureMessageBody(email)
        }
    }
    await Promise.all(Array.from({ length: Math.min(4, emails.length) }, next))
}

export function hasDeferredBodies(emails = Object.values(getState().emails)) {
    return emails.some(email => email.data.bodySource || email.remote?.bodyDeferred)
}

// Authored search uses a text index; private bodies still require authorized message reads.
export async function ensureSearchContent() {
    const emails = Object.values(getState().emails)
    const authored = emails.filter(email => email.data.bodySource && typeof email.data.searchBody !== 'string')
    if (authored.length) {
        const source = document.querySelector('meta[name="portfolio-search"]')?.content
        if (!/^\/script\/content\/search\.[a-f0-9]{16}\.json$/.test(source)) { throw new Error('Invalid public search source') }
        searchRequest ??= fetch(source, { signal: AbortSignal.timeout(15000) }).then(async response => {
            if (!response.ok) { throw new Error('Search content could not load. Try again.') }
            return response.json()
        }).catch(error => { searchRequest = null; throw error })
        const index = await searchRequest
        for (const email of authored) {
            const content = index[email.id]
            if (!content || typeof content.body !== 'string' || typeof content.photo !== 'boolean') {
                throw new Error('Invalid public search content')
            }
            email.data.searchBody = content.body
            email.data.hasPhoto = content.photo
            invalidateSearch(email)
        }
    }
    await ensureBodies(emails.filter(email => email.remote?.bodyDeferred))
    refreshSearchResults()
}

export function watchDeferredSearch(render) {
    document.addEventListener('dmail:mailbox-data', () => {
        const state = getState()
        const query = state.search.query
        if (!query.trim() || !hasDeferredBodies()) { return }
        ensureSearchContent().then(() => {
            if (getState() === state && state.search.query === query) { render() }
        }).catch(error => {
            if (getState() === state && state.search.query === query) {
                render(`Search could not load new message content. ${error.message}`)
            }
        })
    })
}
