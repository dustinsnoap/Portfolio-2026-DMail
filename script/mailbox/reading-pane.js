import { spriteIcon } from '../app/icons.js'
import { loadPreferences, savePreferences } from '../settings/preferences.js'

export function initReadingPane({ onClose }) {
    const { tray, mail, views, toolbar } = arrangeMailbox()
    const controls = buildViewControls(toolbar)
    const empty = document.createElement('div')
    empty.className = 'pane-empty'
    empty.textContent = 'Select a conversation to read it here.'
    views.append(empty)
    const select = controls.querySelector('select')
    let mode = 'off'
    let open = false
    const mobileWidth = window.matchMedia('(width < 800px)')
    try {
        mode = loadPreferences().readingPane ?? 'off'
    } catch {
    }

    function layout() {
        if (!['off', 'right', 'below'].includes(mode)) { mode = 'off' }
        const visibleMode = mobileWidth.matches ? 'off' : mode
        const fullThread = visibleMode === 'off' && open
        views.dataset.pane = visibleMode
        views.classList.toggle('has-thread', open)
        toolbar.hidden = fullThread
        tray.classList.toggle('hidden', fullThread)
        tray.inert = fullThread
        mail.classList.toggle('visible', open)
        mail.inert = !open
        mail.hidden = !open
        empty.hidden = visibleMode === 'off' || open
        document.querySelector('.app').classList.toggle('mobile-thread-open', mobileWidth.matches && open)
        select.value = mode
        controls.querySelector('.pane-control').title = `Reading pane: ${mode[0].toUpperCase() + mode.slice(1)}`
    }
    mobileWidth.addEventListener('change', layout)

    function show() {
        open = true
        layout()
    }

    function close() {
        const wasOpen = open
        open = false
        layout()
        onClose?.()
        if (wasOpen) { document.dispatchEvent(new Event('dmail:thread-close')) }
    }

    function isOpen() {
        return open
    }

    select.addEventListener('change', () => {
        mode = select.value
        layout()
        try {
            savePreferences({ readingPane: mode })
        } catch {
            controls.querySelector('.view-notice').textContent = 'This layout could not be saved.'
        }
    })
    layout()
    return { show, close, isOpen }
}

function arrangeMailbox() {
    const mailbox = document.querySelector('.mailbox')
    const tray = mailbox.querySelector('.tray')
    const mail = mailbox.querySelector('.mail')
    const toolbar = tray.querySelector('.top-bar')
    const views = document.createElement('div')
    views.className = 'mail-views'
    mailbox.prepend(toolbar)
    mailbox.append(views)
    views.append(tray, mail)
    return { tray, mail, views, toolbar }
}

function buildViewControls(toolbar) {
    const controls = document.createElement('div')
    controls.className = 'mailbox-controls'
    controls.innerHTML =
        `
        <label class="option pane-control" title="Reading pane">
            ${spriteIcon('reading-pane', 'class="pane-icon"')}
            ${spriteIcon('chevron', 'class="control-chevron"')}
            <select aria-label="Reading pane">
                <option value="off">Off</option><option value="right">Right</option><option value="below">Below</option>
            </select>
        </label>
        <button type="button" class="option keyboard-help" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
            ${spriteIcon('keyboard', 'class="keyboard-icon"')}
            ${spriteIcon('chevron', 'class="control-chevron"')}
        </button>
        <span class="view-notice" role="status"></span>`
    toolbar.querySelector('.right .options').append(controls)
    return controls
}
