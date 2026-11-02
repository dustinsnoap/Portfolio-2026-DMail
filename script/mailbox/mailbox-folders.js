import { notifyAccountChange } from '../account/account-storage.js'

export const FOLDER_CHOICES_KEY = 'dmail_folder_choices_v1'
const CHOICES = new Set(['archive', 'spam', 'trash', 'hidden'])

export function normalizeFolderChoices(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new TypeError('Invalid saved mailbox folders') }
    return Object.fromEntries(Object.entries(value).filter(([id, folder]) =>
        /^[\w-]{1,120}$/.test(id) && CHOICES.has(folder)))
}

export function loadFolderChoices(storage = globalThis.localStorage) {
    return normalizeFolderChoices(JSON.parse(storage?.getItem(FOLDER_CHOICES_KEY) ?? '{}'))
}

export function saveFolderChoices(changes, storage = localStorage) {
    const choices = loadFolderChoices(storage)
    for (const [id, folder] of Object.entries(changes)) {
        if (!/^[\w-]{1,120}$/.test(id) || (folder !== '' && !CHOICES.has(folder))) { throw new TypeError('Invalid mailbox action') }
        if (choices[id] === 'hidden') { continue }
        if (folder) { choices[id] = folder } else { delete choices[id] }
    }
    storage.setItem(FOLDER_CHOICES_KEY, JSON.stringify(choices))
    notifyAccountChange()
    return choices
}

// Reset restores Archive only; Spam, Trash, and permanent deletion survive it.
export function resetArchivedChoices(storage = localStorage) {
    const choices = loadFolderChoices(storage)
    const archived = Object.entries(choices).filter(([, folder]) => folder === 'archive')
    if (!archived.length) { return choices }
    return saveFolderChoices(Object.fromEntries(archived.map(([id]) => [id, ''])), storage)
}

function messageFolder(message, choice, sent) {
    if (choice === 'hidden') { return 'deleted' }
    if (choice === 'archive') { return sent ? 'sent' : 'archive' }
    if (choice) { return choice }
    if (message.status.deleted) { return 'deleted' }
    return sent ? 'sent' : message.folder === 'inbox' ? message.category : message.folder
}

function conversationFolders(thread, choice) {
    const folders = new Set()
    thread.mailboxFolder = choice || messageFolder(thread.latest, '', thread.latest.folder === 'sent')
    for (const message of thread.messages) {
        message.mailboxFolder = messageFolder(message, choice, message.folder === 'sent')
        message.mailboxArchived = choice === 'archive'
        if (choice === 'hidden' || message.status.deleted) { continue }
        folders.add(message.mailboxFolder)
        if (!['spam', 'trash', 'deleted', 'drafts'].includes(message.mailboxFolder)) { folders.add('all') }
    }
    if (choice === 'archive' && folders.size) { folders.add('archive') }
    return folders
}

// Membership sets preserve insertion order for conversations with equal timestamps.
export function buildFolderIndex(threads, folders, choices) {
    const memberships = Object.values(threads).map(thread => {
        const id = thread.latest.threadId
        return [id, conversationFolders(thread, choices[id])]
    })
    return Object.fromEntries(Object.entries(folders).map(([folder, ids]) => {
        const retained = new Set()
        const added = []
        for (const [id, locations] of memberships) {
            if (!locations.has(folder)) { continue }
            if (ids.has(id)) { retained.add(id) } else { added.push(id) }
        }
        return [folder, [...added.reverse(), ...[...ids].reverse().filter(id => retained.has(id))]]
    }))
}

export function indexConversation(thread, index, choice = '', promote = true) {
    const id = thread.latest.threadId
    const folders = conversationFolders(thread, choice)
    for (const [folder, ids] of Object.entries(index)) {
        const position = ids.indexOf(id)
        const keep = folders.has(folder)
        if (position >= 0 && (!keep || promote)) { ids.splice(position, 1) }
        if (keep && (position < 0 || promote)) { ids.unshift(id) }
    }
}
