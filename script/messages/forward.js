import { addPortfolioEmail, getState, parseRecipients } from '../mailbox/state.js'
import { apiJSON, getMessagingSession } from '../storage/portfolio-api.js'
import { remoteMessage, submitRemoteMessage } from '../storage/remote-mailbox.js'
import { contentText, escapeHtml } from './content.js'

export function initForwarding({ onSent }) {
    const dialog = document.createElement('dialog')
    dialog.className = 'forward-dialog feature-dialog'
    dialog.setAttribute('aria-labelledby', 'forward-title')
    document.body.append(dialog)
    const drafts = new Map()
    let current = ''
    let busy = false

    function saveDraft() {
        const draft = drafts.get(current)
        if (!draft) { return }
        draft.to = dialog.querySelector('[name="forward-to"]').value
        draft.note = dialog.querySelector('[name="forward-note"]').value
    }

    function close() {
        if (busy) { return }
        saveDraft()
        dialog.close()
    }

    async function open(id) {
        if (busy || dialog.open) { return }
        const message = getState().emails[id]
        if (!message) { return }
        current = id
        if (!drafts.has(id)) { drafts.set(id, { to: '', note: '', attempt: null }) }
        const draft = drafts.get(id)
        const body = message.data.format === 'rich' ? contentText(message.data.body) : message.data.format === 'html'
            ? new DOMParser().parseFromString(message.data.body, 'text/html').body.textContent : message.data.body
        dialog.innerHTML = `<form novalidate><header><h2 id="forward-title">Forward message</h2>
            <button type="button" data-close-forward aria-label="Close forward">×</button></header>
            <p class="forward-subject">${escapeHtml(message.data.subject)}</p>
            <label>To<input name="forward-to" aria-label="Forward to" placeholder="Recipient’s opted-in email address"
                inputmode="email" maxlength="5000" value="${escapeHtml(draft.to)}" autocomplete="off"></label>
            <label>Note (optional)<textarea name="forward-note" maxlength="2000">${escapeHtml(draft.note)}</textarea></label>
            <p>10 forwarded emails per account per UTC day. Each recipient must enable forwarding from you first.</p>
            <button type="button" data-manage-forward>Forwarding permissions</button>
            <p>Only the message text is forwarded. Attachments and inline images are not included.</p>
            <details><summary>Message preview</summary><pre>${escapeHtml(body)}</pre></details>
            <p class="forward-status" role="alert"></p><div class="forward-actions">
            <button type="button" data-forward-signin hidden>Sign in</button><button type="button" data-close-forward>Cancel</button>
            <button type="submit" data-send-forward disabled>Forward</button></div></form>`
        dialog.showModal()
        try {
            const session = await getMessagingSession()
            if (current !== id || !dialog.open) { return }
            dialog.querySelector('[data-forward-signin]').hidden = Boolean(session.signedIn)
            dialog.querySelector('[data-send-forward]').disabled = !session.signedIn || !session.forwardEnabled
            dialog.querySelector('.forward-status').textContent = !session.forwardEnabled
                ? 'Email forwarding is waiting for provider setup.' : !session.signedIn ? 'Sign in to forward a message.' : ''
        } catch (error) { dialog.querySelector('.forward-status').textContent = error.message }
        dialog.querySelector('[name="forward-to"]').focus()
    }

    // Reuse the submission ID on retry so a lost response cannot spend another send allowance.
    async function send(event) {
        event.preventDefault()
        if (busy || dialog.querySelector('[data-send-forward]').disabled) { return }
        saveDraft()
        const draft = drafts.get(current)
        const status = dialog.querySelector('.forward-status')
        try {
            const to = parseRecipients(draft.to)
            if (to.length !== 1) { throw new Error('Add one recipient who has enabled forwarding from you.') }
            const signature = JSON.stringify({ source: current, to, note: draft.note })
            if (draft.attempt?.signature !== signature) { draft.attempt = { signature, id: `message-${crypto.randomUUID()}` } }
            busy = true
            for (const control of dialog.querySelectorAll('button, input, textarea')) { control.disabled = true }
            const source = getState().emails[current]
            if (!source.id.startsWith('em-') && !source.remote && !source.forwardOf) { await submitRemoteMessage(source, true) }
            const receipt = await apiJSON(`/messages/${encodeURIComponent(current)}/forward`, { id: draft.attempt.id, to, note: draft.note })
            const record = remoteMessage(receipt, true)
            addPortfolioEmail(record)
            drafts.delete(current)
            dialog.close()
            onSent(record)
        } catch (error) { status.textContent = `${error.message} Your draft is still here.` } finally {
            busy = false
            for (const control of dialog.querySelectorAll('button, input, textarea')) { control.disabled = false }
        }
    }

    function click(event) {
        if (event.target.closest('[data-close-forward]')) { close() }
        if (event.target.closest('[data-manage-forward]') && !busy) {
            close()
            document.dispatchEvent(new Event('dmail:forward-permissions'))
        }
        if (event.target.closest('[data-forward-signin]') && !busy) {
            close()
            document.querySelector('[data-open-signin]').click()
        }
    }

    function handleClick(target) {
        if (!target.closest('.thread-forward, .message .forward')) { return false }
        const id = target.closest('.message')?.dataset.id || getState().threads[document.querySelector('.mail').dataset.threadId]?.latest.id
        open(id)
        return true
    }

    dialog.addEventListener('submit', send)
    dialog.addEventListener('input', saveDraft)
    dialog.addEventListener('click', click)
    dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
    return { handleClick }
}
