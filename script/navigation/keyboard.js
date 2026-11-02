import { renderEmailList } from '../mailbox/render.js'
import { getState, getVisiblePage, getVisibleThreads, showMessagePage } from '../mailbox/state.js'
import { getGeneralPreferences } from '../settings/general-preferences.js'
import { keyboardAction } from './keyboard-shortcuts.js'

export { keyboardAction }

export function initKeyboard({ openThread, back, reply, star, select, isThreadOpen }) {
    const dialog = document.createElement('dialog')
    dialog.className = 'shortcuts-dialog feature-dialog'
    dialog.setAttribute('aria-labelledby', 'shortcuts-title')
    dialog.innerHTML =
        '<div class="dialog-heading"><h2 id="shortcuts-title">Keyboard shortcuts</h2>' +
        `<button type="button" aria-label="Close shortcuts">×</button></div>
        <dl><dt>/</dt><dd>Search</dd><dt>j / k</dt><dd>Next / previous conversation</dd><dt>Enter</dt><dd>Open focused conversation</dd>
        <dt>c</dt><dd>Compose</dd><dt>r</dt><dd>Reply to open conversation</dd><dt>s</dt>` +
        `<dd>Toggle star</dd><dt>x</dt><dd>Select focused conversation</dd>
        <dt>Esc</dt><dd>Close conversation or current dialog</dd><dt>Ctrl / ⌘ + Enter</dt><dd>Send</dd><dt>?</dt><dd>This shortcut guide</dd></dl>
        <p class="shortcut-status"></p>`
    document.body.append(dialog)
    dialog.querySelector('button').onclick = () => dialog.close()
    function showGuide() {
        const general = getGeneralPreferences()
        const navigation = general.shortcuts ? 'Single-key shortcuts pause while you type or use a dialog.'
            : 'Single-key shortcuts are off. Standard keyboard navigation stays enabled.'
        const sending = general.sendShortcut ? 'Ctrl / ⌘ + Enter to send is on.' : 'Ctrl / ⌘ + Enter to send is off.'
        dialog.querySelector('.shortcut-status').textContent = `${navigation} ${sending}`
        if (!dialog.open) { dialog.showModal() }
    }

    document.querySelector('.keyboard-help').onclick = showGuide
    document.addEventListener('dmail:show-shortcuts', showGuide)
    let focused = ''

    function rows() {
        return [...document.querySelectorAll('.email-list .email')]
    }
    function focusRow(id) {
        if (showMessagePage(id)) { renderEmailList() }
        const currentRows = rows()
        const row = currentRows.find((item) => item.dataset.id === id)
        if (!row) { return }
        focused = id
        for (const item of currentRows) { item.classList.toggle('keyboard-focused', item === row) }
        row.focus({ preventScroll: true })
        row.scrollIntoView({ block: 'nearest' })
    }
    document.querySelector('.email-list').addEventListener('focusin', (event) => {
        const row = event.target.closest('.email')
        if (row) { focused = row.dataset.id }
    })
    document.addEventListener('dmail:list-render', () => {
        if (!rows().some((row) => row.dataset.id === focused)) { focused = '' }
    })
    function currentMessage() {
        return isThreadOpen() ? getState().threads[document.querySelector('.mail').dataset.threadId]?.latest.id : focused
    }

    function moveConversation(event, action) {
        const threads = getVisibleThreads()
        if (!threads.length) { return }
        event.preventDefault()
        const index = threads.findIndex(thread => thread.latest.id === currentMessage())
        const page = getVisiblePage()
        const next = index < 0 ? (action === 'next' ? page.start : page.start + page.threads.length - 1)
            : Math.max(0, Math.min(threads.length - 1, index + (action === 'next' ? 1 : -1)))
        const thread = threads[next]
        if (isThreadOpen()) { openThread(thread.latest.threadId) } else { focusRow(thread.latest.id) }
    }

    function actOnConversation(event, action) {
        const current = currentMessage()
        if (action === 'open' && event.target.closest('button, a')) { return }
        if (action === 'reply' && isThreadOpen()) {
            event.preventDefault()
            reply()
        }
        if (action === 'back' && isThreadOpen()) {
            event.preventDefault()
            back()
            focusRow(current)
        }
        if (action === 'open' && current) {
            event.preventDefault()
            openThread(getState().emails[current].threadId)
        }
        if (action === 'star' && current) {
            event.preventDefault()
            star(current)
        }
        if (action === 'select' && focused && !isThreadOpen()) {
            event.preventDefault()
            select(focused)
        }
    }

    function handleKeyboard(event) {
        const blocked = 'dialog[open], [popover]:popover-open, .settings-view:not([hidden]), ' +
            '.quick-settings:not([hidden]), .compose-layer:not([hidden])'
        if (document.querySelector(blocked)) { return }
        const action = keyboardAction(event, getGeneralPreferences().shortcuts)
        if (!action || action === 'search') { return }
        if (action === 'next' || action === 'previous') { return moveConversation(event, action) }
        if (action === 'help') {
            event.preventDefault()
            showGuide()
            return
        }
        if (action === 'compose') {
            event.preventDefault()
            document.querySelector('.sidebar .compose button').click()
            return
        }
        actOnConversation(event, action)
    }

    document.addEventListener('keydown', handleKeyboard)
}
