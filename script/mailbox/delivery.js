import { accountCacheAvailable, notifyAccountChange } from '../account/account-storage.js'
import { summarizeReadingProgress } from './reading-progress.js'

const MAX_TIMEOUT = 2147483647

// Keep scheduled messages out of mailbox state until their delivery conditions are met.
export function createDelivery({ emails }) {
    validateDeliveryRules(emails)
    const ids = Object.keys(emails)
    const pending = new Set(ids.filter(id => emails[id].delivery))
    const available = new Set(ids.filter(id => !emails[id].delivery))
    let progress = readProgress()
    let onArrival = null
    let timer = null
    let running = false
    let readingCache = null

    function readProgress() {
        let saved = null
        try {
            if (accountCacheAvailable) { saved = JSON.parse(localStorage.getItem(DELIVERY_STORAGE_KEY)) }
        } catch { }
        return normalizeProgress(saved, ids, Date.now())
    }

    function saveProgress() {
        if (!accountCacheAvailable) { return }
        progress = mergeProgress(progress, readProgress())
        const serialized = JSON.stringify(normalizeProgress(progress, ids, Date.now()))
        try {
            if (localStorage.getItem(DELIVERY_STORAGE_KEY) !== serialized) {
                localStorage.setItem(DELIVERY_STORAGE_KEY, serialized)
                notifyAccountChange()
            }
        } catch { }
    }

    // Date arrivals when this visitor receives them, rather than using the catalog date.
    function deliveredMessage(id) {
        return { ...emails[id], timestamp: new Date(progress.delivered[id]).toISOString() }
    }

    function releaseDue() {
        const now = Date.now()
        const arrivals = []
        for (const id of pending) {
            if (progress.delivered[id] === undefined && deliveryTime(emails[id].delivery, progress) > now) { continue }
            progress.delivered[id] ??= now
            pending.delete(id)
            available.add(id)
            arrivals.push(deliveredMessage(id))
        }
        if (arrivals.length) {
            saveProgress()
            arrivals.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
            onArrival?.(arrivals)
        }
    }

    // Browser timers overflow past 2^31 - 1 ms; cap each scheduled wait.
    function scheduleNext() {
        clearTimeout(timer)
        timer = null
        if (!running) { return }
        let next = Infinity
        for (const id of pending) { next = Math.min(next, deliveryTime(emails[id].delivery, progress)) }
        if (Number.isFinite(next)) { timer = setTimeout(checkDue, Math.min(MAX_TIMEOUT, Math.max(1, next - Date.now()))) }
    }

    function checkDue() {
        releaseDue()
        scheduleNext()
    }

    function syncProgress() {
        progress = mergeProgress(progress, readProgress())
        checkDue()
        document.dispatchEvent(new Event('dmail:reading-progress'))
    }

    function opened(messageIds) {
        progress = mergeProgress(progress, readProgress())
        let changed = false
        for (const id of messageIds) {
            if (!available.has(id) || progress.opened[id] !== undefined) { continue }
            progress.opened[id] = Date.now()
            changed = true
        }
        if (changed) { saveProgress() }
        checkDue()
        if (changed) { document.dispatchEvent(new Event('dmail:reading-progress')) }
    }

    function handleStorage(event) {
        if (!accountCacheAvailable || event.key !== DELIVERY_STORAGE_KEY) { return }
        try {
            const saved = normalizeProgress(JSON.parse(event.newValue), ids, Date.now())
            progress = mergeProgress(progress, saved)
        } catch { }
        syncProgress()
        saveProgress()
    }

    function handleVisibility() {
        if (document.visibilityState === 'visible') { syncProgress() }
    }

    function start(callback) {
        if (running) { return }
        running = true
        onArrival = callback
        window.addEventListener('storage', handleStorage)
        window.addEventListener('pageshow', syncProgress)
        document.addEventListener('visibilitychange', handleVisibility)
        syncProgress()
    }

    function stop() {
        running = false
        clearTimeout(timer)
        onArrival = null
        window.removeEventListener('storage', handleStorage)
        window.removeEventListener('pageshow', syncProgress)
        document.removeEventListener('visibilitychange', handleVisibility)
    }

    // Welcome messages use this visitor's first-visit date.
    function immediateMessage(id) {
        if (emails[id].receivedAt !== 'firstVisit') { return emails[id] }
        return { ...emails[id], timestamp: new Date(progress.firstVisit).toISOString() }
    }

    function visibleSeed() {
        const visible = ids.filter(id => !emails[id].delivery).map(immediateMessage)
        const delivered = ids.filter(id => emails[id].delivery && available.has(id)).map(deliveredMessage)
        delivered.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
        return { emails: Object.fromEntries([...visible, ...delivered].map(email => [email.id, email])) }
    }

    // Folder changes can affect reading progress without changing the available-message count.
    function readingProgress(threads, version) {
        if (version !== undefined && readingCache?.threads === threads && readingCache.version === version
            && readingCache.opened === progress.opened && readingCache.available === available.size) { return readingCache.value }
        const value = summarizeReadingProgress(emails, available, progress.opened, threads)
        readingCache = { threads, version, opened: progress.opened, available: available.size, value }
        return value
    }

    releaseDue()
    saveProgress()
    return { seed: visibleSeed(), opened, start, stop, readingProgress }
}

const RULE_FIELDS = new Set(['afterOpen', 'at', 'delayMs'])

export function validateDeliveryRules(emails) {
    for (const [id, email] of Object.entries(emails)) {
        if (email.id !== id) { throw new TypeError(`Message key must match its ID: ${id}`) }
        if (email.delivery === undefined) { continue }
        const rule = email.delivery
        if (!rule || typeof rule !== 'object' || Array.isArray(rule) || !Object.keys(rule).length) {
            throw new TypeError(`Delivery rule must contain a condition: ${id}`)
        }
        if (Object.keys(rule).some(key => !RULE_FIELDS.has(key))) { throw new TypeError(`Unknown delivery condition: ${id}`) }
        if ('afterOpen' in rule && (typeof rule.afterOpen !== 'string' || !Object.hasOwn(emails, rule.afterOpen))) {
            throw new TypeError(`Delivery dependency must reference an existing message: ${id}`)
        }
        if ('at' in rule && (typeof rule.at !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(rule.at) || !isTime(Date.parse(rule.at)))) {
            throw new TypeError(`Delivery date must include a timezone: ${id}`)
        }
        if ('delayMs' in rule && !isTime(rule.delayMs)) { throw new TypeError(`Delivery delay must be nonnegative milliseconds: ${id}`) }
    }
    validateDependencies(emails)
}

function validateDependencies(emails) {
    const checked = new Set()
    for (const id of Object.keys(emails)) {
        const path = new Set()
        let current = id
        while (current && !checked.has(current)) {
            if (path.has(current)) { throw new TypeError(`Circular delivery dependency: ${current}`) }
            path.add(current)
            current = emails[current].delivery?.afterOpen
        }
        for (const visited of path) { checked.add(visited) }
    }
}

export function deliveryTime(rule, progress) {
    if (!rule) { return 0 }
    const base = rule.afterOpen ? progress.opened[rule.afterOpen] : progress.firstVisit
    if (base === undefined) { return Infinity }
    return Math.max(base + (rule.delayMs ?? 0), rule.at ? Date.parse(rule.at) : 0)
}

export function isTime(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000
}

export const DELIVERY_STORAGE_KEY = 'dmail_delivery_v1'

export function normalizeProgress(source, ids, now) {
    return {
        firstVisit: isTime(source?.firstVisit) ? Math.min(source.firstVisit, now) : now,
        opened: normalizeTimes(source?.opened, ids, now),
        delivered: normalizeTimes(source?.delivered, ids, now),
    }
}

function normalizeTimes(source, ids, now) {
    const times = Object.create(null)
    if (!source || typeof source !== 'object' || Array.isArray(source)) { return times }
    for (const id of ids) {
        if (Object.hasOwn(source, id) && isTime(source[id]) && source[id] <= now) { times[id] = source[id] }
    }
    return times
}

export function mergeProgress(current, saved) {
    return {
        firstVisit: Math.min(current.firstVisit, saved.firstVisit),
        opened: mergeTimes(current.opened, saved.opened),
        delivered: mergeTimes(current.delivered, saved.delivered),
    }
}

// Use the earliest recorded event when tabs disagree on its timestamp.
function mergeTimes(current, saved) {
    const merged = Object.assign(Object.create(null), current)
    for (const [id, time] of Object.entries(saved)) { merged[id] = Math.min(merged[id] ?? Infinity, time) }
    return merged
}
