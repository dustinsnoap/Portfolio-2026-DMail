import { notifyAccountChange } from '../account/account-storage.js'

const KEY = 'dmail_preferences_v1'

export function loadPreferences(storage = localStorage) {
    const value = JSON.parse(storage.getItem(KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new TypeError('Invalid saved preferences') }
    return value
}

export function savePreferences(changes, storage = localStorage) {
    const value = { ...loadPreferences(storage), ...changes }
    storage.setItem(KEY, JSON.stringify(value))
    notifyAccountChange()
    return value
}
