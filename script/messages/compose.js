import { spriteIcon } from '../app/icons.js'
import { OWNER_NAME } from '../app/identity.js'
import { renderEmailList, renderThread } from '../mailbox/render.js'
import { addMessage, addReply, createMessage, createReply, getState } from '../mailbox/state.js'
import { isSendShortcut } from '../navigation/keyboard-shortcuts.js'
import { getGeneralPreferences } from '../settings/general-preferences.js'
import { saveMessage, saveReply } from '../storage/persistence.js'
import { identifySubmission } from '../storage/remote-mailbox.js'
import { escapeHtml } from './content.js'
import { buildEditor, mountEditor, readEditor, readEditorAttachments, setEditorBusy } from './editor.js'
import { announceEditor } from './editor-status.js'
import { buildSenderField, PORTFOLIO_OWNER } from './message-model.js'
import { renderReplyForm } from './reply-form.js'

export function initCompose({ onSent }) {
    const trigger = document.querySelector('.sidebar .compose button')
    const app = document.querySelector('.app')
    const layer = document.createElement('div')
    layer.className = 'compose-layer'
    layer.hidden = true
    document.body.append(layer)
    let form = null
    let busy = false
    let sendObserver = null
    const mobileWidth = window.matchMedia('(width < 800px)')

    function expand(expanded) {
        layer.classList.toggle('expanded', expanded)
        app.inert = expanded
        form.setAttribute('aria-modal', String(expanded))
        const button = form.querySelector('[data-compose="expand"]')
        button.setAttribute('aria-label', expanded ? 'Exit full screen' : 'Full screen')
        button.setAttribute('aria-pressed', String(expanded))
    }

    function minimize(minimized) {
        if (minimized) { expand(false) }
        form.classList.toggle('minimized', minimized)
        form.querySelector('.compose-content').inert = minimized
        form.querySelector('[data-compose="minimize"]').setAttribute('aria-label', minimized ? 'Restore compose' : 'Minimize compose')
        if (minimized) {
            form.querySelector('[data-compose="minimize"]').focus()
        } else { form.querySelector('.editor-body').focus({ preventScroll: true }) }
    }

    function close(discard = false) {
        expand(false)
        layer.hidden = true
        if (discard) {
            sendObserver?.disconnect()
            form.remove()
            form = null
        }
        trigger.focus()
    }

    function setBusy(value) {
        busy = value
        form.querySelectorAll('button, input, select, textarea').forEach((control) => {
            control.disabled = value
        })
        setEditorBusy(form.querySelector('.message-editor'), value)
    }

    function mountCompose() {
        layer.innerHTML = buildCompose()
        form = layer.querySelector('form')
        form.elements.to.value = PORTFOLIO_OWNER.name
        mountEditor(form.querySelector('.message-editor'))
        const send = form.querySelector('.editor-send')
        const headerSend = form.querySelector('.mobile-send')
        sendObserver = new MutationObserver(() => {
            headerSend.disabled = send.disabled
        })
        sendObserver.observe(send, { attributes: true, attributeFilter: ['disabled'] })
        for (const recipient of form.querySelectorAll('.compose-address input')) {
            recipient.inputMode = 'email'
            recipient.enterKeyHint = 'next'
        }
    }

    function open() {
        if (busy) { return }
        if (!form) { mountCompose() }
        layer.hidden = false
        minimize(false)
        if (mobileWidth.matches) { expand(true) }
        form.querySelector('[name="subject"]').focus()
    }

    function openFromMobile(event) {
        if (event.target.closest('[data-compose-open]')) { open() }
    }

    function resizeCompose() {
        if (!form || layer.hidden) { return }
        if (mobileWidth.matches) {
            minimize(false)
            expand(true)
        }
    }

    function handleComposeClick(event) {
        if (busy) { return }
        const button = event.target.closest('[data-compose], [data-action="discard"]')
        if (button) {
            if (button.dataset.action === 'discard') { return close(true) }
            const action = button.dataset.compose
            if (action === 'attach') { return form.querySelector('.attachment-picker').click() }
            if (action === 'close') { return close() }
            if (action === 'minimize') { return minimize(!form.classList.contains('minimized')) }
            if (action === 'expand') {
                if (form.classList.contains('minimized')) { minimize(false) }
                return expand(!layer.classList.contains('expanded'))
            }
            const row = form.querySelector(`[data-recipient="${action}"]`)
            if (row) {
                row.hidden = false
                button.hidden = true
                button.setAttribute('aria-expanded', 'true')
                row.querySelector('input').focus()
            }
            return
        }
        if (form.classList.contains('minimized') && event.target.closest('.compose-header')) { minimize(false) }
    }

    function updateSubject(event) {
        if (event.target.name !== 'subject') { return }
        form.querySelector('h2').textContent = event.target.value.trim() || 'New Message'
    }

    function submitComposeShortcut(event) {
        if (!isSendShortcut(event, getGeneralPreferences().sendShortcut)) { return false }
        if (!event.target.closest('.editor-body, .compose-fields')) { return false }
        event.preventDefault()
        if (!form.querySelector('.editor-send').disabled) { form.requestSubmit() }
        return true
    }

    function advanceComposeField(event) {
        if (event.key !== 'Enter' || event.isComposing || !event.target.closest('.compose-fields')) { return false }
        event.preventDefault()
        const next = event.target.name === 'subject' ? '.editor-body' : '[name="subject"]'
        form.querySelector(next).focus()
        return true
    }

    function closeComposeShortcut(event) {
        if (event.key !== 'Escape') { return }
        event.preventDefault()
        if (layer.classList.contains('expanded') && !mobileWidth.matches) { expand(false) } else { close() }
    }

    function handleComposeShortcuts(event) {
        if (submitComposeShortcut(event) || advanceComposeField(event)) { return }
        closeComposeShortcut(event)
    }

    function trapComposeFocus(event) {
        if (event.key === 'Tab' && layer.classList.contains('expanded')) {
            const controls = Array.from(form.querySelectorAll('button, input, select, textarea, [contenteditable="true"]')).filter(
                (control) => !control.disabled && control.getClientRects().length,
            )
            const first = controls[0]
            const last = controls.at(-1)
            if ((event.shiftKey && event.target === first) || (!event.shiftKey && event.target === last)) {
                event.preventDefault()
                const next = event.shiftKey ? last : first
                next.focus()
            }
        }
    }

    function handleComposeKeys(event) {
        if (event.defaultPrevented || busy) { return }
        handleComposeShortcuts(event)
        if (!event.defaultPrevented) { trapComposeFocus(event) }
    }

    function readComposeMessage() {
        const fields = form.elements
        const editor = form.querySelector('.message-editor')
        return createMessage({ senderName: fields.senderName.value, to: PORTFOLIO_OWNER.email, cc: fields.cc.value,
            bcc: fields.bcc.value, subject: fields.subject.value, body: readEditor(editor), attachments: readEditorAttachments(editor),
        })
    }

    function finishMessage(message) {
        addMessage(message)
        close(true)
        onSent(message)
    }

    async function submitMessage(event) {
        event.preventDefault()
        if (busy || form.querySelector('.editor-send').disabled) { return }
        let message
        try { message = readComposeMessage() } catch (error) {
            announceEditor(form, error.message, 'editor', true)
            return
        }
        setBusy(true)
        try {
            identifySubmission(message, form)
            await saveMessage(message)
            finishMessage(message)
        } catch (error) {
            announceEditor(form, `${error.message} Your draft is still here.`, 'editor', true)
            console.warn('Unable to save composed message', error)
        } finally {
            busy = false
            if (form) { setBusy(false) }
        }
    }

    function bindComposeEvents() {
        trigger.addEventListener('click', open)
        document.addEventListener('click', openFromMobile)
        mobileWidth.addEventListener('change', resizeCompose)
        layer.addEventListener('click', handleComposeClick)
        layer.addEventListener('input', updateSubject)
        layer.addEventListener('keydown', handleComposeKeys)
        layer.addEventListener('submit', submitMessage)
    }

    bindComposeEvents()
    return { close }
}

export function buildCompose() {
    return (
        `
                <form class="compose-window" role="dialog" aria-labelledby="compose-title" aria-modal="false" novalidate>
                    <header class="compose-header">
                        <h2 id="compose-title">New Message</h2>
                        <button type="button" class="mobile-header-tool" data-compose="attach" aria-label="Attach files">
                            ${spriteIcon('attach')}
                        </button>
                        <button type="submit" class="mobile-header-tool mobile-send" aria-label="Send message" disabled>
                            ${spriteIcon('sent')}
                        </button>
                        <button type="button" data-compose="minimize" aria-label="Minimize compose" title="Minimize">−</button>
                        <button type="button" data-compose="expand" aria-label="Full screen" aria-pressed="false" title="Full screen">
                            ${spriteIcon('expand')}
                        </button>
                        <button type="button" data-compose="close" aria-label="Close compose" title="Save draft and close">×</button>
                    </header>
                    <div class="compose-content">
                        <div class="compose-fields">
                            ${buildSenderField()}
                            <div class="compose-address">
                                <label for="compose-to">To</label>` +
        `<input id="compose-to" name="to" readonly autocomplete="off" spellcheck="false" aria-describedby="compose-address-help">


                            </div>
                            <div class="compose-address" data-recipient="cc" hidden>
                                <label for="compose-cc">Cc</label>` +
        `<input id="compose-cc" name="cc" autocomplete="off" spellcheck="false" aria-describedby="compose-address-help">
                            </div>
                            <div class="compose-address" data-recipient="bcc" hidden>
                                <label for="compose-bcc">Bcc</label>` +
        `<input id="compose-bcc" name="bcc" autocomplete="off" spellcheck="false" aria-describedby="compose-address-help">
                            </div>
                            <input class="compose-subject" name="subject" aria-label="Subject"` +
        ` placeholder="Subject" maxlength="200" autocomplete="off">
                            <span id="compose-address-help" class="visually-hidden">
                                Messages from this portfolio go to ${escapeHtml(OWNER_NAME)}.</span>
                        </div>
                        ${buildEditor('Message body', { placeholder: 'Compose email', discardLabel: 'Discard draft' })}
                    </div>
                </form>`
    )
}

export function initReplies(mail, closeMenu) {
    const drafts = new Map()

    function openReply(messageId, body = [], attachments = [], senderName = '') {
        const threadId = mail.dataset.threadId
        // Capture the originating thread so later edits cannot update a different conversation's draft.
        function saveDraft(content, files, name) {
            drafts.set(threadId, { messageId, body: content, attachments: files, senderName: name })
        }

        renderReplyForm(messageId, body, saveDraft, attachments, senderName)
    }

    function discardReply() {
        drafts.delete(mail.dataset.threadId)
        closeReply()
    }

    function closeReply() {
        const form = mail.querySelector('.reply-form')
        if (!form || form.querySelector('[aria-busy="true"]')) { return }
        form.remove()
        mail.querySelector('.thread-footer').hidden = false
        mail.querySelector('.thread-reply').focus()
    }

    function replyToMessage(replyButton) {
        const thread = getState().threads[mail.dataset.threadId]
        const messageId =
            replyButton.closest('.message')?.dataset.id ?? (thread.messages.findLast((email) => email.folder !== 'sent') ?? thread.latest).id
        const draft = drafts.get(mail.dataset.threadId)
        const body = draft?.body ?? []
        closeMenu()
        openReply(messageId, body, draft?.attachments, draft?.senderName)
    }

    async function submitReply(event) {
        const form = event.target
        if (!form.matches('.reply-form')) { return }
        event.preventDefault()
        const button = form.querySelector('.editor-send')
        if (button.disabled) { return }
        const threadId = mail.dataset.threadId
        const submittedDraft = drafts.get(threadId)
        const editor = form.querySelector('.message-editor')
        setReplyBusy(form, true)
        try {
            const reply = createReply(form.dataset.id, readEditor(editor), readEditorAttachments(editor), form.elements.senderName.value)
            identifySubmission(reply, form)
            await saveReply(reply)
            finishReply(reply, threadId, submittedDraft)
        } catch (error) {
            reportSaveFailure(form, error)
        }
    }

    function submitReplyShortcut(event) {
        if (!isSendShortcut(event, getGeneralPreferences().sendShortcut)) { return false }
        const form = event.target.closest('.reply-form')
        if (!form || !event.target.closest('.editor-body, [name="senderName"]')) { return false }
        event.preventDefault()
        if (!form.querySelector('.editor-send').disabled) { form.requestSubmit() }
        return true
    }

    function advanceReplySender(event) {
        const sender = event.target.closest('.reply-form [name="senderName"]')
        if (event.key !== 'Enter' || event.isComposing || !sender) { return false }
        event.preventDefault()
        sender.closest('form').querySelector('.editor-body').focus()
        return true
    }

    function restoreDraft(threadId) {
        const draft = drafts.get(threadId)
        if (draft) { openReply(draft.messageId, draft.body, draft.attachments, draft.senderName) }
        return Boolean(draft)
    }

    function setReplyBusy(form, busy) {
        form.querySelector('.editor-send').disabled = busy
        setEditorBusy(form.querySelector('.message-editor'), busy)
        form.elements.senderName.disabled = busy
    }

    // A completed send must not discard a newer draft created while it was pending.
    function finishReply(reply, threadId, submittedDraft) {
        addReply(reply)
        if (drafts.get(threadId) === submittedDraft) { drafts.delete(threadId) }
        renderEmailList()
        if (mail.dataset.threadId !== threadId || !mail.classList.contains('visible')) { return }
        closeMenu()
        renderThread(threadId)
        if (restoreDraft(threadId)) { return }
        mail.querySelector('.thread-stack').lastElementChild.scrollIntoView({ block: 'nearest' })
        mail.querySelector('.thread-reply').focus()
    }

    function reportSaveFailure(form, error) {
        announceEditor(form, `${error.message} Your text is still here.`, 'editor', true)
        console.warn('Unable to save reply', error)
        setReplyBusy(form, false)
    }

    document.addEventListener('submit', submitReply)
    return { restoreDraft, discardReply, closeReply, replyToMessage, submitReplyShortcut, advanceReplySender }
}
