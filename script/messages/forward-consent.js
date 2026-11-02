import { apiJSON, apiRequest, getMessagingSession } from '../storage/portfolio-api.js'
import { escapeHtml } from './content.js'

async function permissions(direction) {
    const items = []
    const seen = new Set()
    let cursor = ''
    let setupLink = ''
    do {
        const response = await apiRequest(`/forwarding?direction=${direction}&cursor=${encodeURIComponent(cursor)}`)
        const page = await response.json()
        if (!Array.isArray(page.items)) { throw new Error('Unable to read forwarding permissions.') }
        items.push(...page.items)
        setupLink = page.setupLink
        cursor = page.nextCursor || ''
        if (cursor && seen.has(cursor)) { throw new Error('Unable to read the next permissions page.') }
        seen.add(cursor)
    } while (cursor)
    return { items, setupLink }
}

export function initForwardConsent() {
    const dialog = document.createElement('dialog')
    dialog.className = 'forward-dialog consent-dialog feature-dialog'
    dialog.setAttribute('aria-labelledby', 'consent-title')
    document.body.append(dialog)
    let token = ''
    let busy = false
    let generation = 0

    function frame(title, body) {
        dialog.innerHTML = `<header><h2 id="consent-title">${title}</h2>
            <button type="button" data-consent-close aria-label="Close forwarding permissions">×</button></header>
            ${body}<p class="forward-status" role="status"></p>`
        if (!dialog.open) { dialog.showModal() }
        dialog.querySelector('button')?.focus()
    }

    // Keep setup links through sign-in; remove them only when the invitation is explicitly closed.
    function close(retainLink = false) {
        if (busy) { return }
        generation++
        dialog.close()
        if (!retainLink && new URLSearchParams(location.search).has('forwarding')) {
            const url = new URL(location.href)
            url.searchParams.delete('forwarding')
            history.replaceState(history.state, '', url.pathname + url.search + url.hash)
        }
    }

    function requireSignIn() {
        frame('Forwarding permissions', `<p>Sign in with the email address where you want to receive forwards.
            New accounts must verify their email before enabling forwarding.</p>
            <div class="forward-actions"><button type="button" data-consent-signin>Sign in</button></div>`)
    }

    // Recipient identity comes from the verified account, never the sender's editable address.
    async function openInvite(value) {
        token = value
        const current = ++generation
        frame('Receive forwarded emails', '<p>Loading forwarding setup…</p>')
        try {
            const session = await getMessagingSession()
            if (current !== generation || !dialog.open) { return }
            if (!session.signedIn) { return requireSignIn() }
            const response = await apiRequest(`/forwarding/invites/${encodeURIComponent(token)}`)
            const invite = await response.json()
            if (current !== generation || !dialog.open) { return }
            if (!invite.verifiedEmail) {
                frame('Verify your email', '<p>Sign out and sign in again with a verified Dmail email to enable forwarding.</p>')
                return
            }
            frame('Receive forwarded emails', `<p>Allow ${escapeHtml(invite.senderName)} to forward messages to your verified address:</p>
                <p><strong>${escapeHtml(invite.verifiedEmail)}</strong></p>
                <form data-consent-form><label class="consent-check"><input type="checkbox" name="agree" required>
                    <span>${escapeHtml(invite.wording)}</span></label>
                    <p>Dmail records this permission and its confirmation time. You can revoke it in your account’s
                    Forwarding permissions. Receiving is still subject to email-provider availability.</p>
                    <div class="forward-actions"><button type="button" data-consent-close>Cancel</button>
                    <button type="submit" data-consent-enable disabled>Enable forwarding</button></div></form>`)
        } catch (error) { if (current === generation) { dialog.querySelector('.forward-status').textContent = error.message } }
    }

    async function openManagement() {
        const current = ++generation
        frame('Forwarding permissions', '<p>Loading permissions…</p>')
        try {
            const session = await getMessagingSession()
            if (current !== generation || !dialog.open) { return }
            if (!session.signedIn) { return requireSignIn() }
            const [sent, received] = await Promise.all([permissions('sent'), permissions('received')])
            if (current !== generation || !dialog.open) { return }
            const outgoing = sent.items.map(item => `<li>${escapeHtml(item.email)} — ${item.revokedAt ? 'Stopped' : 'Enabled'}</li>`).join('')
            const incoming = received.items.map(item => `<li><strong>${escapeHtml(item.senderName)}</strong>
                <span>${escapeHtml(item.email)}</span><small>Confirmed ${escapeHtml(new Date(item.confirmedAt).toLocaleString())}</small>
                ${item.revokedAt ? '<span>Stopped</span>' : `<button type="button"
                    data-consent-revoke="${escapeHtml(item.id)}">Stop forwarding</button>`}</li>`).join('')
            frame('Forwarding permissions', `<p>Recipients must enable forwarding themselves. Share this setup link through an existing
                communication channel. Dmail does not email invitations.</p>
                <label>Your setup link<input readonly aria-label="Your forwarding setup link" value="${escapeHtml(sent.setupLink)}"></label>
                <div class="forward-actions"><button type="button" data-consent-copy>Copy link</button>
                    <button type="button" data-consent-self="${escapeHtml(sent.setupLink)}">Enable for my address</button></div>
                <h3>You can forward to</h3><ul>${outgoing || '<li>No recipients have enabled forwarding yet.</li>'}</ul>
                <h3>Emails you agreed to receive</h3><ul class="consent-subscriptions">${incoming || '<li>No forwarding permissions yet.</li>'}</ul>
                <p>Each sender can forward 10 emails per UTC day. Forwarding includes text only.</p>`)
        } catch (error) { if (current === generation) { dialog.querySelector('.forward-status').textContent = error.message } }
    }

    async function submit(event) {
        event.preventDefault()
        if (busy || !dialog.querySelector('[name="agree"]')?.checked) { return }
        busy = true
        for (const control of dialog.querySelectorAll('button, input')) { control.disabled = true }
        try {
            await apiJSON('/forwarding/consent', { token, wordingVersion: 'forwarding-v1', agree: true })
            frame('Forwarding enabled', `<p>You have allowed this sender to forward emails to your verified address.
                You can stop at any time in Forwarding permissions.</p>
                <div class="forward-actions"><button type="button" data-consent-manage>Manage permissions</button>
                <button type="button" data-consent-close>Done</button></div>`)
        } catch (error) { dialog.querySelector('.forward-status').textContent = error.message } finally {
            busy = false
            for (const control of dialog.querySelectorAll('button, input')) { control.disabled = false }
        }
    }

    async function click(event) {
        const target = event.target.closest('button')
        if (!target || busy) { return }
        if (target.matches('[data-consent-close]')) { close() }
        if (target.matches('[data-consent-signin]')) {
            close(true)
            document.querySelector('[data-open-signin]').click()
        }
        if (target.matches('[data-consent-self]')) { openInvite(new URL(target.dataset.consentSelf).searchParams.get('forwarding')) }
        if (target.matches('[data-consent-manage]')) { openManagement() }
        try {
            if (target.matches('[data-consent-copy]')) {
                await navigator.clipboard.writeText(dialog.querySelector('input[readonly]').value)
                dialog.querySelector('.forward-status').textContent = 'Setup link copied.'
            }
            if (target.matches('[data-consent-revoke]')) {
                busy = target.disabled = true
                await apiJSON(`/forwarding/consents/${encodeURIComponent(target.dataset.consentRevoke)}/revoke`, {})
                await openManagement()
            }
        } catch (error) { dialog.querySelector('.forward-status').textContent = error.message } finally {
            busy = false
            target.disabled = false
        }
    }

    dialog.addEventListener('click', click)
    dialog.addEventListener('submit', submit)
    dialog.addEventListener('change', () => {
        const checkbox = dialog.querySelector('[name="agree"]')
        if (checkbox) { dialog.querySelector('[data-consent-enable]').disabled = !checkbox.checked }
    })
    dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
    document.addEventListener('dmail:forward-permissions', openManagement)
    document.addEventListener('click', event => {
        if (!event.target.closest('[data-forward-permissions]')) { return }
        for (const panel of document.querySelectorAll('[popover]:popover-open')) { panel.hidePopover() }
        openManagement()
    })
    const setup = new URLSearchParams(location.search).get('forwarding')
    if (setup === 'manage') { openManagement() } else if (setup) { openInvite(setup) }
}
