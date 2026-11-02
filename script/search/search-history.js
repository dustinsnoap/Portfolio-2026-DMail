import { notifyAccountChange } from '../account/account-storage.js'

export const SEARCH_HISTORY_KEY = 'dmail_search_history_v1'

export function normalizeHistory(value) {
    if (!Array.isArray(value)) { return [] }
    const queries = value.filter(query => typeof query === 'string' && query.trim() && query.length <= 500)
    return [...new Set(queries.map(query => query.trim()))].slice(0, 6)
}

export function loadSearchHistory(storage) {
    try { return normalizeHistory(JSON.parse((storage ?? localStorage).getItem(SEARCH_HISTORY_KEY) || '[]')) } catch { return [] }
}

export function rememberSearch(query, storage) {
    if (typeof query !== 'string' || !query.trim() || query.length > 500) { return }
    const history = normalizeHistory([query, ...loadSearchHistory(storage)])
    try {
        (storage ?? localStorage).setItem(SEARCH_HISTORY_KEY, JSON.stringify(history))
        notifyAccountChange()
    } catch { }
}

export function clearSearchHistory(storage) {
    const target = storage ?? localStorage
    target.removeItem(SEARCH_HISTORY_KEY)
    notifyAccountChange()
}
