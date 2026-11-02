import { loadPreferences } from './preferences.js'

export const START_SECTIONS = Object.freeze({ primary: 'Primary', projects: 'Projects', articles: 'Writing', updates: 'Updates', all: 'All mail' })
export const GENERAL_DEFAULTS = Object.freeze({ shortcuts: true, sendShortcut: true, startSection: 'primary',
    externalLinks: true, rememberSearches: true })
let current = null
let connected = false

export function normalizeGeneral(value) {
    const saved = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const result = { ...GENERAL_DEFAULTS }
    for (const key of ['shortcuts', 'sendShortcut', 'externalLinks', 'rememberSearches']) {
        if (typeof saved[key] === 'boolean') { result[key] = saved[key] }
    }
    if (typeof saved.startSection === 'string' && Object.hasOwn(START_SECTIONS, saved.startSection)) { result.startSection = saved.startSection }
    return result
}

export function readGeneralPreferences(storage) {
    try { return normalizeGeneral(loadPreferences(storage).general) } catch { return { ...GENERAL_DEFAULTS } }
}

export function getGeneralPreferences() {
    current ??= readGeneralPreferences()
    return current
}

function refreshPreferences(event) {
    if (event.type === 'storage' && event.key !== 'dmail_preferences_v1' && event.key !== null) { return }
    current = readGeneralPreferences()
}

export function initGeneralPreferences() {
    if (connected) { return }
    connected = true
    current = readGeneralPreferences()
    document.addEventListener('dmail:general-change', refreshPreferences)
    window.addEventListener('storage', refreshPreferences)
    window.addEventListener('pageshow', refreshPreferences)
}

function prepareExternalLink(event) {
    const link = event.target.closest('a[href]')
    if (!link || link.hasAttribute('download')) { return }
    const url = new URL(link.href)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === location.origin) { return }
    link.target = getGeneralPreferences().externalLinks ? '_blank' : '_self'
    link.relList.add('noopener', 'noreferrer')
}

export function initGeneralLinks() {
    document.addEventListener('click', prepareExternalLink, true)
    document.addEventListener('auxclick', prepareExternalLink, true)
}
