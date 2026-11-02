import { publicPageForThread } from '../navigation/conversation-links.js'
import { getMessagingSession, messagingConfigured } from '../storage/portfolio-api.js'

// Classify referrers locally; never send their hostnames, paths, or query strings.
export function referralCategory(referrer, origin) {
    if (!referrer) { return 'directLoads' }
    let host
    try {
        const url = new URL(referrer)
        if (url.origin === origin) { return '' }
        host = url.hostname
    } catch { return 'otherReferrals' }
    const matches = domain => host === domain || host.endsWith(`.${domain}`)
    if (['chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'claude.ai', 'copilot.microsoft.com', 'gemini.google.com'].some(matches)) {
        return 'aiReferrals'
    }
    if (['google.com', 'google.co.uk', 'google.ca', 'google.de', 'google.fr', 'google.co.in', 'google.com.au',
        'bing.com', 'duckduckgo.com', 'search.yahoo.com'].some(matches)) {
        return 'searchReferrals'
    }
    return 'otherReferrals'
}

// Report anonymous totals only; never send identities, message IDs, search terms, or content.
export function initTelemetry(mailboxReady) {
    if (!messagingConfigured()) { return }
    if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) { return }
    let counts = { pageLoads: 1 }
    let timings = {}
    let timer
    const opened = new Set()
    const observers = []
    const source = referralCategory(document.referrer, location.origin)
    if (source) { counts[source] = 1 }
    if (matchMedia('(width < 800px)').matches) { counts.mobileLoads = 1 }
    if (Number.isFinite(mailboxReady)) { timings.mailboxReady = mailboxReady }
    const navigation = performance.getEntriesByType('navigation')[0]
    if (navigation) { timings.ttfb = navigation.responseStart - navigation.startTime }

    function flush() {
        clearTimeout(timer)
        if (!Object.keys(counts).length && !Object.keys(timings).length) { return }
        const body = JSON.stringify({ counts, timings })
        counts = {}; timings = {}
        getMessagingSession().then(() => fetch('/api/portfolio/metrics', { method: 'POST', body, keepalive: true,
            credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Portfolio-Request': '1' } })).catch(() => {})
    }

    function increment(name) {
        counts[name] = Math.min(100, (counts[name] || 0) + 1)
        clearTimeout(timer)
        timer = setTimeout(flush, 2000)
    }

    function threadOpened() {
        const id = document.querySelector('.mail.visible')?.dataset.threadId
        const page = publicPageForThread(id)
        if (!page || opened.has(id)) { return }
        opened.add(id)
        increment({ projects: 'projectOpens', articles: 'writingOpens', updates: 'updateOpens' }[page[2]])
    }

    function download(event) {
        if (event.target.closest('a[download][href*="/api/portfolio/assets/resume/resume.pdf"]')) { increment('resumeDownloads') }
    }

    const finishVitals = observeVitals(observers)
    function leaving() {
        if (document.visibilityState !== 'hidden') { return }
        finishVitals(timings)
        flush()
    }

    function stop() {
        finishVitals(timings)
        flush()
        for (const observer of observers) { observer.disconnect() }
        document.removeEventListener('dmail:thread-opened', threadOpened)
        document.removeEventListener('click', download, true)
        document.removeEventListener('visibilitychange', leaving)
    }

    document.addEventListener('dmail:thread-opened', threadOpened)
    document.addEventListener('click', download, true)
    document.addEventListener('visibilitychange', leaving)
    window.addEventListener('pagehide', stop, { once: true })
    threadOpened()
    timer = setTimeout(flush, 2000)
}

// Measure LCP and session-window CLS directly; do not label long tasks as INP.
function observeVitals(observers) {
    let lcp = null
    let cls = null
    let session = 0
    let first = 0
    let last = 0
    let finished = false
    const callbacks = new Map()
    if (!globalThis.PerformanceObserver) { return () => {} }
    function observe(type, callback) {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) { return }
        const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) { callback(entry) } })
        observer.observe({ type, buffered: true })
        observers.push(observer)
        callbacks.set(observer, callback)
    }
    observe('largest-contentful-paint', entry => { lcp = entry.startTime })
    if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) { cls = 0 }
    observe('layout-shift', entry => {
        if (entry.hadRecentInput) { return }
        if (!first || entry.startTime - last > 1000 || entry.startTime - first > 5000) {
            session = 0; first = entry.startTime
        }
        last = entry.startTime
        session += entry.value
        cls = Math.max(cls ?? 0, session)
    })
    // Emit each supported vital once; an unsupported measurement must not become a zero.
    return target => {
        if (finished) { return }
        for (const [observer, callback] of callbacks) { for (const entry of observer.takeRecords()) { callback(entry) } }
        finished = true
        if (lcp !== null) { target.lcp = Math.min(300000, lcp) }
        if (cls !== null) { target.cls = Math.min(300000, cls * 1000) }
    }
}
