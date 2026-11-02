import { OWNER_FIRST_NAME } from '../app/identity.js'
import { messagingConfigured } from '../storage/portfolio-api.js'
import { FOLDER_CHOICES_KEY, loadFolderChoices, saveFolderChoices } from './mailbox-folders.js'
import { createMailboxRefresh } from './mailbox-refresh.js'
import { READ_STATUS_KEY, restoreReadStatus, saveConversationRead } from './mailbox-status.js'
import { renderEmailList } from './render.js'
import { applyFolderChoices, conversationUnread, getState, getVisibleThreads, refreshCachedMailbox } from './state.js'

export function initMailboxActions({ closeConversation, closeMenu }) {
    const mail = document.querySelector('.mail')
    const refresh = createMailboxRefresh({ refresh: refreshCachedMailbox, render: renderEmailList })

    function targets(button) {
        const state = getState()
        const ids = button.closest('.mail') ? [mail.dataset.threadId]
            : [...state.selected].map(id => state.emails[id]?.threadId)
        return [...new Set(ids)].filter(id => state.threads[id] && state.threads[id].mailboxFolder !== 'hidden')
    }

    // Close hidden conversations before leaving their body and attachment controls reachable.
    function closeChangedConversation(ids) {
        if (!ids.includes(mail.dataset.threadId)) { return }
        closeConversation()
        mail.replaceChildren()
        delete mail.dataset.threadId
        const preview = document.querySelector('.file-preview')
        if (preview?.open) { preview.close() }
    }

    function commit(ids, choice) {
        if (!ids.length) { return }
        try {
            const choices = saveFolderChoices(Object.fromEntries(ids.map(id => [id, choice])))
            applyFolderChoices(choices)
            closeMenu()
            closeChangedConversation(ids)
            renderEmailList()
            document.querySelector('.email-list .email, .bulk-select')?.focus({ preventScroll: true })
        } catch (error) {
            renderEmailList(`Mailbox change could not be saved. ${error.message}`)
        }
    }

    function handle(target) {
        if (target.closest('.top-bar .refresh')) {
            closeMenu()
            refresh()
            return true
        }
        const button = target.closest('[data-mail-action]')
        if (!button || button.disabled) { return false }
        const action = button.dataset.mailAction
        const ids = action.endsWith('-all') ? getVisibleThreads().map(thread => thread.latest.threadId) : targets(button)
        if (!ids.length) { return true }
        if (['read', 'unread', 'read-all', 'unread-all'].includes(action)) {
            changeRead(ids, action.startsWith('read'))
            return true
        }
        if (action === 'delete-forever') {
            if (!ids.every(id => getState().threads[id].mailboxFolder === 'trash')) { return true }
            const message = `Delete ${ids.length === 1 ? 'this conversation' : `${ids.length} conversations`} forever from this browser? `
                + 'You will lose access in this mailbox, including after a cache reset.'
                + (messagingConfigured() ? ` ${OWNER_FIRST_NAME} keeps a copy of the conversation.` : '')
            if (!confirm(message)) { return true }
            commit(ids, 'hidden')
        } else if (action === 'archive') {
            commit(ids.filter(id => !['trash', 'spam', 'drafts'].includes(getState().threads[id].mailboxFolder)), 'archive')
        } else if (['trash', 'spam', 'restore'].includes(action)) { commit(ids, action === 'restore' ? '' : action) }
        return true
    }

    function changeRead(ids, read) {
        try {
            saveConversationRead(ids, read)
            closeMenu()
            if (!read) { closeChangedConversation(ids) }
            renderEmailList()
        } catch (error) { renderEmailList(`Read status could not be saved. ${error.message}`) }
    }

    function updateToolbar() {
        const folder = getState().activeCategory
        const trash = document.querySelector('.top-bar .action.trash')
        const spam = document.querySelector('.top-bar .action.spam')
        const restore = document.querySelector('.top-bar .action.restore')
        const deleting = folder === 'trash' ? 'Delete forever' : 'Delete'
        trash.dataset.mailAction = folder === 'trash' ? 'delete-forever' : 'trash'
        trash.setAttribute('aria-label', deleting)
        trash.title = deleting
        spam.dataset.mailAction = folder === 'spam' ? 'restore' : 'spam'
        spam.setAttribute('aria-label', folder === 'spam' ? 'Not spam' : 'Mark as spam')
        spam.title = spam.getAttribute('aria-label')
        const selected = [...getState().selected].map(id => getState().threads[getState().emails[id]?.threadId]).filter(Boolean)
        const archived = selected.length > 0 && selected.every(thread => thread.mailboxFolder === 'archive')
        restore.hidden = folder !== 'trash' && !archived
        restore.setAttribute('aria-label', 'Restore conversation')
        restore.title = 'Restore to original location'
        document.querySelector('.top-bar .action.archive').hidden = ['archive', 'trash', 'spam', 'drafts'].includes(folder)
        const reading = selected.some(conversationUnread)
        const readButton = document.querySelector('.top-bar .action.unread')
        readButton.dataset.mailAction = reading ? 'read' : 'unread'
        readButton.setAttribute('aria-label', reading ? 'Mark as read' : 'Mark as unread')
        readButton.title = readButton.getAttribute('aria-label')
    }

    function synchronize(event) {
        if (event.key === READ_STATUS_KEY) {
            try { restoreReadStatus(); renderEmailList() } catch (error) { renderEmailList(error.message) }
            return
        }
        if (event.key !== FOLDER_CHOICES_KEY) { return }
        try {
            const before = getState().folderChoices
            const choices = loadFolderChoices()
            const changed = Object.keys(getState().threads).filter(id => before[id] !== choices[id])
            applyFolderChoices(choices)
            closeMenu()
            closeChangedConversation(changed)
            renderEmailList()
        } catch (error) { renderEmailList(`Mailbox changes could not be loaded. ${error.message}`) }
    }

    document.addEventListener('dmail:list-render', updateToolbar)
    document.addEventListener('dmail:selection-change', updateToolbar)
    window.addEventListener('storage', synchronize)
    updateToolbar()
    return { handle }
}
