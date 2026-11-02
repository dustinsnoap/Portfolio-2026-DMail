let sessionRequest
let ownerCredential = ''
const BASE = '/api/portfolio'

export function messagingConfigured() {
    return Boolean(globalThis.document?.querySelector('meta[name="portfolio-api"]'))
}

export async function apiRequest(path, { method = 'GET', body, headers = {}, timeout = 25000 } = {}) {
    if (!messagingConfigured()) { throw new Error('This feature is available on the live portfolio at dustinsnoap.com.') }
    let response
    try {
        response = await fetch(`${BASE}${path}`, { method, body, credentials: 'same-origin', cache: 'no-store',
            signal: AbortSignal.timeout(timeout), headers: { 'X-Portfolio-Request': '1',
                ...(ownerCredential ? { Authorization: `Bearer ${ownerCredential}` } : {}), ...headers } })
    } catch (cause) { throw new Error('Could not connect. Check your connection and try again.', { cause }) }
    if (!response.ok) {
        const problem = await response.json().catch(() => ({}))
        const error = new Error(problem.error || `Messaging request failed (${response.status}). Please try again.`)
        error.status = response.status
        error.code = problem.code
        throw error
    }
    return response
}

export async function apiJSON(path, value, headers = {}) {
    const response = await apiRequest(path, { method: 'POST', body: JSON.stringify(value),
        headers: { 'Content-Type': 'application/json', ...headers } })
    return response.json()
}

export function getMessagingSession(refresh = false) {
    if (!messagingConfigured()) {
        return Promise.resolve({ signedIn: false, owner: false, mailEnabled: false, chatbotEnabled: false,
            forwardEnabled: false, signIn: { enabled: false } })
    }
    if (refresh) { sessionRequest = null }
    if (!sessionRequest) {
        sessionRequest = apiRequest('/session').then(response => response.json()).catch(error => {
            sessionRequest = null
            throw error
        })
    }
    return sessionRequest
}

// Keep the local owner credential in memory only; never put it in URLs or browser storage.
export function setOwnerCredential(value) {
    ownerCredential = value
    sessionRequest = null
}

// An empty filtered page can still have a continuation cursor; keep fetching until the cursor ends.
export async function listRemoteMessages(scope, summary = false) {
    const messages = []
    const seen = new Set()
    let cursor = ''
    do {
        const query = `scope=${scope}${summary ? '&view=summary' : ''}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
        const response = await apiRequest(`/messages?${query}`)
        const page = await response.json()
        if (!Array.isArray(page.messages)) { throw new Error('Invalid mailbox response') }
        messages.push(...page.messages)
        cursor = page.nextCursor || ''
        if (cursor && seen.has(cursor)) { throw new Error('Invalid mailbox continuation') }
        seen.add(cursor)
    } while (cursor)
    return messages
}
