// Navigation can close a feature before its module finishes loading.
export function initOptionalFeatures({ mail, labels, closeMenu, onSent, onSettingsOpen }) {
    let messages
    let messageRequest
    let settings
    let settingsRequest
    let generation = 0

    function report(error) {
        const status = document.querySelector('.view-notice')
        status.textContent = `This feature could not load. Try again. ${error.message}`
    }

    function loadMessages() {
        messageRequest ??= Promise.all([import('../messages/compose.js'), import('../messages/forward.js')])
            .then(([compose, forward]) => {
                messages = { compose: compose.initCompose({ onSent }), replies: compose.initReplies(mail, closeMenu),
                    forwarding: forward.initForwarding({ onSent }) }
                return messages
            }).catch(error => { messageRequest = null; throw error })
        return messageRequest
    }

    async function composeClick(event) {
        const trigger = event.target.closest('.sidebar .compose button, .mobile-compose')
        if (!trigger || messages) { return }
        event.preventDefault()
        event.stopImmediatePropagation()
        const ticket = generation
        try {
            await loadMessages()
            if (ticket === generation && trigger.isConnected) { trigger.click() }
        } catch (error) { report(error) }
    }

    async function settingsClick(event) {
        const trigger = event.target.closest('[data-open-settings]')
        if (!trigger || trigger.disabled || settings) { return }
        event.preventDefault()
        event.stopImmediatePropagation()
        const ticket = generation
        try {
            settingsRequest ??= import('../settings/settings.js').then(module => {
                settings = module.initSettings(labels, { onOpen: onSettingsOpen })
            }).catch(error => { settingsRequest = null; throw error })
            await settingsRequest
            if (ticket === generation && trigger.isConnected) { trigger.click() }
        } catch (error) { report(error) }
    }

    async function replyToMessage(button) {
        const thread = mail.dataset.threadId
        const ticket = generation
        try {
            await loadMessages()
            if (ticket === generation && button.isConnected && mail.dataset.threadId === thread) {
                messages.replies.replyToMessage(button)
            }
        } catch (error) { report(error) }
    }

    function forwardClick(target) {
        if (!target.closest('.thread-forward, .message .forward')) { return false }
        const thread = mail.dataset.threadId
        const ticket = generation
        loadMessages().then(() => {
            if (ticket === generation && target.isConnected && mail.dataset.threadId === thread) {
                messages.forwarding.handleClick(target)
            }
        }).catch(report)
        return true
    }

    document.addEventListener('click', composeClick, true)
    document.addEventListener('click', settingsClick, true)
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { generation++ } }, true)
    document.addEventListener('dmail:thread-close', () => { generation++ })
    return {
        compose: { close: () => { generation++; messages?.compose.close() } },
        settings: { close: restore => { generation++; settings?.close(restore) } },
        forwarding: { handleClick: forwardClick },
        replies: { replyToMessage,
            restoreDraft: thread => messages?.replies.restoreDraft(thread) ?? false,
            discardReply: () => messages?.replies.discardReply(),
            closeReply: () => messages?.replies.closeReply(),
            submitReplyShortcut: event => messages?.replies.submitReplyShortcut(event) ?? false,
            advanceReplySender: event => messages?.replies.advanceReplySender(event) ?? false },
    }
}
