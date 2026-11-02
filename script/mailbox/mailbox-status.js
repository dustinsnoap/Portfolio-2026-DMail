import { notifyAccountChange } from '../account/account-storage.js'
import { getState, setReadStatus, toggleStar } from './state.js'

export const READ_STATUS_KEY = 'dmail_read_v1'

function loadReadStatus(storage) {
    const saved = JSON.parse(storage.getItem(READ_STATUS_KEY) ?? '{}')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) { throw new TypeError('Invalid saved read status') }
    return Object.fromEntries(Object.entries(saved).filter(([id, read]) => /^[\w-]{1,120}$/.test(id) && typeof read === 'boolean'))
}

export function restoreReadStatus(storage = localStorage) {
    const saved = loadReadStatus(storage)
    for (const read of [true, false]) { setReadStatus(Object.keys(saved).filter(id => saved[id] === read), read) }
}

export function saveConversationRead(threadIds, read, storage = localStorage) {
    if (typeof read !== 'boolean') { throw new TypeError('Use a valid read status') }
    const state = getState()
    const ids = [...new Set(threadIds)].flatMap(id => {
        const thread = state.threads[id]
        return thread && thread.mailboxFolder !== 'hidden' ? thread.messages.map(message => message.id) : []
    })
    if (!ids.length || ids.every(id => state.emails[id].status.read === read)) { return }
    const saved = loadReadStatus(storage)
    for (const id of ids) { saved[id] = read }
    storage.setItem(READ_STATUS_KEY, JSON.stringify(saved))
    setReadStatus(ids, read)
    notifyAccountChange()
}

export const STARS_KEY = 'dmail_stars_v1'

function loadStars(storage) {
    const value = JSON.parse(storage.getItem(STARS_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new TypeError('Invalid saved stars') }
    return Object.fromEntries(Object.entries(value).filter(([id, starred]) => id.length <= 120 && typeof starred === 'boolean'))
}

export function restoreStars(storage = localStorage) {
    for (const [id, starred] of Object.entries(loadStars(storage))) {
        const message = getState().emails[id]
        if (message && message.status.starred !== starred) { toggleStar(id) }
    }
}

export function toggleSavedStar(id, storage = localStorage) {
    const message = getState().emails[id]
    if (!message) { return }
    const stars = { ...loadStars(storage), [id]: !message.status.starred }
    storage.setItem(STARS_KEY, JSON.stringify(stars))
    notifyAccountChange()
    toggleStar(id)
}
