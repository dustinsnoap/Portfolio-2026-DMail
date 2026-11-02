import { apiJSON, apiRequest, getMessagingSession } from '../storage/portfolio-api.js'
import {
    ACCOUNT_MARKER, accountChanges, accountSnapshot, AVATAR_KEY, clearAccountCache, restoreAccountCache, restoreAccountSettings, verifyAccountCache,
} from './account-storage.js'

let accountId = ''
let version = 0
let saved = {}
let savedAvatar = ''
let timer
let writing = null
let stopped = false
let checking = null
const PENDING_KEY = 'dmail_account_pending_v1'

function report(message) {
    document.dispatchEvent(new CustomEvent('dmail:account-status', { detail: message }))
}

export async function restoreAccount(session) {
    const marker = localStorage.getItem(ACCOUNT_MARKER)
    if (!session.signedIn) {
        if (marker) { clearAccountCache() }
        return
    }
    if (marker && marker !== session.accountId) { clearAccountCache() }
    verifyAccountCache(session)
    const response = await apiRequest('/account')
    const profile = await response.json()
    const firstAccount = profile.version === 1 && !Object.keys(profile.settings).length && !marker
    if (!firstAccount) {
        restoreAccountSettings(profile.settings, profile.avatar)
    }
    localStorage.setItem(ACCOUNT_MARKER, session.accountId)
    restoreAccountCache(session.accountId)
    let pending = null
    try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null') } catch { }
    accountId = session.accountId
    version = profile.version
    saved = firstAccount ? {} : accountSnapshot()
    savedAvatar = firstAccount ? '' : localStorage.getItem(AVATAR_KEY) || ''
    if (pending?.accountId === accountId) {
        for (const key of Object.keys(accountSnapshot())) {
            if (!Object.hasOwn(pending.changes || {}, key)) { continue }
            const value = pending.changes[key]
            if (typeof value === 'string') { localStorage.setItem(key, value) } else if (value === null) { localStorage.removeItem(key) }
        }
        if (typeof pending.avatar === 'string') {
            if (pending.avatar) { localStorage.setItem(AVATAR_KEY, pending.avatar) } else { localStorage.removeItem(AVATAR_KEY) }
        }
    }
    if (firstAccount || pending?.accountId === accountId) { await flushAccount() }
    document.dispatchEvent(new Event('dmail:appearance-change'))
}

// Serialize account writes so a slower request cannot overwrite a newer edit.
export function flushAccount() {
    clearTimeout(timer)
    if (writing) { return writing.then(flushAccount) }
    if (!accountId || stopped || localStorage.getItem(ACCOUNT_MARKER) !== accountId) { return Promise.resolve() }
    const snapshot = accountSnapshot()
    const avatar = localStorage.getItem(AVATAR_KEY) || ''
    const changes = accountChanges(snapshot, saved)
    if (!Object.keys(changes).length && avatar === savedAvatar) {
        localStorage.removeItem(PENDING_KEY)
        return Promise.resolve()
    }
    rememberPending(changes, avatar)
    report('Saving your account…')
    writing = writePatch({ accountId, version, changes, ...(avatar !== savedAvatar ? { avatar } : {}) }).then(result => {
        version = result.version
        saved = snapshot
        savedAvatar = avatar
        report('Saved to your account')
    }).catch(error => {
        report(error.status === 401 ? 'Your session expired. Sign in again to save changes.'
            : 'Changes are saved in this browser. Account sync failed; please retry.')
        if (error.status === 401) { document.dispatchEvent(new Event('dmail:session-expired')) }
        throw error
    }).finally(() => { writing = null })
    return writing.then(flushAccount)
}

// Retry version conflicts with fresh settings so other tabs' keys survive.
async function writePatch(patch) {
    try { return await apiJSON('/account', patch) } catch (error) {
        if (error.status !== 409) { throw error }
        const response = await apiRequest('/account')
        const latest = await response.json()
        return apiJSON('/account', { ...patch, version: latest.version })
    }
}

function queueSave() {
    if (stopped || !accountId) { return }
    if (localStorage.getItem(ACCOUNT_MARKER) !== accountId) { return }
    rememberPending(accountChanges(accountSnapshot(), saved), localStorage.getItem(AVATAR_KEY) || '')
    clearTimeout(timer)
    timer = setTimeout(() => flushAccount().catch(() => {}), 600)
}

function rememberPending(changes, avatar) {
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify({ accountId, changes, ...(avatar !== savedAvatar ? { avatar } : {}) }))
    } catch { /* Remote saving must still work when local storage is full. */ }
}

// Preparing a cache is not an account change; recheck the shared cookie before invalidating drafts.
function verifyAccountSession() {
    checking ??= getMessagingSession(true).then(session => {
        if ((session.accountId || '') !== accountId) { location.reload() }
    }).catch(() => report('Connection unavailable. Your account data remains saved.')).finally(() => { checking = null })
    return checking
}

export function startAccountSync() {
    document.addEventListener('dmail:account-change', queueSave)
    window.addEventListener('storage', event => {
        if (event.key === ACCOUNT_MARKER) { void verifyAccountSession() } else { queueSave() }
    })
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { flushAccount().catch(() => {}) } else if (accountId) { void verifyAccountSession() }
    })
}

export function stopAccountSync() {
    stopped = true
    clearTimeout(timer)
}
