import { escapeHtml } from './content.js'

const MINUTE = 60000
const HOUR = 60 * MINUTE
const relativeFormat = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const yearFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const exactFormat = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full', timeStyle: 'long',
})

// Compare calendar dates rather than 24-hour intervals, which fail across daylight-saving changes.
function sameDay(left, right) {
    return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

export function formatTimestamp(iso, now = Date.now()) {
    const date = new Date(iso)
    if (!Number.isFinite(date.getTime())) { return 'Date unavailable' }
    const today = new Date(now)
    const elapsed = now - date.getTime()
    if (elapsed >= 0 && sameDay(date, today)) {
        if (elapsed < MINUTE) { return 'Now' }
        return relativeFormat.format(-Math.floor(elapsed / (elapsed < HOUR ? MINUTE : HOUR)), elapsed < HOUR ? 'minute' : 'hour')
    }
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    if (sameDay(date, yesterday)) { return 'Yesterday' }
    return (date.getFullYear() === today.getFullYear() ? dayFormat : yearFormat).format(date)
}

export function timestampMarkup(iso, now = Date.now()) {
    const date = new Date(iso)
    if (!Number.isFinite(date.getTime())) { return '<span class="timestamp">Date unavailable</span>' }
    const exact = escapeHtml(exactFormat.format(date))
    return `<time class="timestamp" datetime="${date.toISOString()}" title="${exact}" aria-label="${exact}">` +
        `${escapeHtml(formatTimestamp(iso, now))}</time>`
}

export function nextTimestampChange(iso, now = Date.now()) {
    const date = new Date(iso)
    if (!Number.isFinite(date.getTime())) { return Infinity }
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0)
    const elapsed = now - date.getTime()
    if (elapsed < 0) { return Math.min(midnight.getTime(), date.getTime()) }
    if (!sameDay(date, new Date(now))) { return midnight.getTime() }
    const interval = elapsed < HOUR ? MINUTE : HOUR
    return Math.min(midnight.getTime(), date.getTime() + (Math.floor(elapsed / interval) + 1) * interval)
}

export function initTimestampClock() {
    let timer = null

    function refresh() {
        clearTimeout(timer)
        timer = null
        if (document.visibilityState !== 'visible') { return }
        const now = Date.now()
        let next = Infinity
        for (const element of document.querySelectorAll('time.timestamp[datetime]')) {
            const iso = element.getAttribute('datetime')
            const label = formatTimestamp(iso, now)
            if (element.textContent !== label) { element.textContent = label }
            next = Math.min(next, nextTimestampChange(iso, now))
        }
        if (Number.isFinite(next)) { timer = setTimeout(refresh, Math.max(1, next - now)) }
    }

    function stop() {
        clearTimeout(timer)
        for (const event of ['dmail:list-render', 'dmail:thread-render', 'visibilitychange']) {
            document.removeEventListener(event, refresh)
        }
        window.removeEventListener('pageshow', refresh)
    }

    for (const event of ['dmail:list-render', 'dmail:thread-render', 'visibilitychange']) { document.addEventListener(event, refresh) }
    window.addEventListener('pageshow', refresh)
    refresh()
    return { stop }
}
