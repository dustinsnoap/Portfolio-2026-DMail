export const ACCOUNT_KEYS = Object.freeze([
    'dmail_preferences_v1', 'dmail_stars_v1', 'dmail_folder_choices_v1', 'dmail_read_v1',
    'dmail_delivery_v1', 'dmail_search_history_v1',
])
export const ACCOUNT_MARKER = 'dmail_account_id'
export const AVATAR_KEY = 'dmail_avatar_v1'
const LOCAL_ACCOUNT_KEYS = ['smail_messages_v1', 'smail_replies_v1', 'dmail_account_pending_v1']
export let accountCacheAvailable = true
export const ACCOUNT_CACHE_NOTICE = 'Saved messages are unavailable until your account is verified. '
    + 'Free browser storage and reload to recover them. Your original records have been retained.'

// Hide cached private records until the server verifies their account.
export function prepareAccountCache(storage = localStorage) {
    try {
        if (storage.getItem(ACCOUNT_MARKER)) { clearAccountCache(storage) }
        accountCacheAvailable = true
    } catch (error) {
        accountCacheAvailable = false
        console.warn('Unable to isolate saved account records', error)
    }
    return accountCacheAvailable
}

export function verifyAccountCache(session, storage = localStorage) {
    if (session.signedIn && session.accountId === storage.getItem(ACCOUNT_MARKER)) { accountCacheAvailable = true }
}

export function accountSnapshot(storage = localStorage) {
    return Object.fromEntries(ACCOUNT_KEYS.map(key => [key, storage.getItem(key)]))
}

export function accountChanges(current, previous) {
    return Object.fromEntries(ACCOUNT_KEYS.filter(key => current[key] !== previous[key]).map(key => [key, current[key]]))
}

export function notifyAccountChange() {
    globalThis.document?.dispatchEvent(new Event('dmail:account-change'))
}

export function restoreAccountSettings(settings, avatar, storage = localStorage) {
    for (const key of ACCOUNT_KEYS) {
        if (typeof settings[key] === 'string') { storage.setItem(key, settings[key]) } else { storage.removeItem(key) }
    }
    if (avatar) { storage.setItem(AVATAR_KEY, avatar) } else { storage.removeItem(AVATAR_KEY) }
}

// Keep the originals if archiving fails; clearing first would lose unsynced mail.
export function clearAccountCache(storage = localStorage) {
    const accountId = storage.getItem(ACCOUNT_MARKER)
    if (accountId) {
        for (const key of LOCAL_ACCOUNT_KEYS) {
            const value = storage.getItem(key)
            if (value !== null) { storage.setItem(`${key}:${accountId}`, value) }
        }
    }
    for (const key of [...ACCOUNT_KEYS, AVATAR_KEY, ACCOUNT_MARKER, ...LOCAL_ACCOUNT_KEYS]) {
        storage.removeItem(key)
    }
}

export function restoreAccountCache(accountId, storage = localStorage) {
    for (const key of LOCAL_ACCOUNT_KEYS) {
        const value = storage.getItem(`${key}:${accountId}`)
        if (value === null) { continue }
        const current = storage.getItem(key)
        if (key !== 'dmail_account_pending_v1' && current !== null) {
            const records = new Map([...JSON.parse(value), ...JSON.parse(current)].map(record => [record.id, record]))
            storage.setItem(key, JSON.stringify([...records.values()]))
        } else { storage.setItem(key, value) }
    }
    for (const key of LOCAL_ACCOUNT_KEYS) { storage.removeItem(`${key}:${accountId}`) }
}
