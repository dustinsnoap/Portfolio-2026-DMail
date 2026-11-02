export const ACTIVITY_KEY = 'dmail_activity_v1'
const WRITE_INTERVAL = 30000

export function activityText(timestamp, now = Date.now()) {
    const minutes = Math.floor(Math.max(0, now - timestamp) / 60000)
    if (minutes === 0) { return 'Last activity: just now' }
    if (minutes < 60) { return `Last activity: ${minutes} minute${minutes === 1 ? '' : 's'} ago` }
    const hours = Math.floor(minutes / 60)
    if (hours < 24) { return `Last activity: ${hours} hour${hours === 1 ? '' : 's'} ago` }
    const days = Math.floor(hours / 24)
    return `Last activity: ${days} day${days === 1 ? '' : 's'} ago`
}

export function initActivity() {
    const label = document.querySelector('[data-last-activity]')
    let latest = readActivity()
    let savedAt = 0
    let timer = null
    let displayedSecond = -1
    const timestampFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' })

    function readActivity(fallback = Date.now()) {
        try {
            const value = Number(localStorage.getItem(ACTIVITY_KEY))
            if (Number.isSafeInteger(value) && value > 0 && value <= Date.now()) { return value }
        } catch { }
        return fallback
    }

    function saveActivity() {
        latest = Math.max(latest, readActivity(latest))
        try { localStorage.setItem(ACTIVITY_KEY, String(latest)) } catch { }
        savedAt = Date.now()
    }

    function renderActivity() {
        clearTimeout(timer)
        const text = activityText(latest)
        if (label.textContent !== text) { label.textContent = text }
        const second = Math.floor(latest / 1000)
        if (displayedSecond !== second) {
            displayedSecond = second
            label.title = `Last click or keyboard interaction in this browser: ${timestampFormat.format(latest)}`
        }
        if (document.visibilityState === 'visible') {
            const delay = 60000 - Math.max(0, Date.now() - latest) % 60000
            timer = setTimeout(renderActivity, delay)
        }
    }

    function recordActivity(event) {
        if (!event.isTrusted || event.isComposing || (event.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key))) { return }
        const previousSecond = Math.floor(latest / 1000)
        latest = Date.now()
        if (latest - savedAt >= WRITE_INTERVAL) { saveActivity() }
        if (Math.floor(latest / 1000) !== previousSecond) { renderActivity() }
    }

    function handleVisibility() {
        if (document.visibilityState === 'hidden') {
            clearTimeout(timer)
            saveActivity()
        } else {
            latest = Math.max(latest, readActivity())
            renderActivity()
        }
    }

    function stop() {
        clearTimeout(timer)
        document.removeEventListener('click', recordActivity, true)
        document.removeEventListener('keydown', recordActivity, true)
        document.removeEventListener('visibilitychange', handleVisibility)
        window.removeEventListener('pagehide', saveActivity)
        window.removeEventListener('pageshow', renderActivity)
    }

    document.addEventListener('click', recordActivity, { capture: true, passive: true })
    document.addEventListener('keydown', recordActivity, { capture: true, passive: true })
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', saveActivity)
    window.addEventListener('pageshow', renderActivity)

    renderActivity()
    return { stop }
}
