import { renderEmailList, updateOpenThread } from '../mailbox/render.js'
import { getMessagingSession, messagingConfigured } from '../storage/portfolio-api.js'
import { pollRemoteMailbox } from '../storage/remote-mailbox.js'

export function initChatbotMailbox() {
    let active = true
    let busy = false

    async function receive() {
        if (!active || busy || document.hidden || !messagingConfigured()) { return }
        busy = true
        try {
            const session = await getMessagingSession()
            if (!active || !session.chatbotEnabled) { return }
            const added = await pollRemoteMailbox(() => active)
            if (active && added) {
                updateOpenThread()
                renderEmailList()
                document.dispatchEvent(new Event('dmail:mailbox-data'))
            }
        } catch {
            // Keep existing mail visible; the next visible cycle retries this request.
        } finally {
            busy = false
        }
    }

    const timer = setInterval(receive, 5000)
    document.addEventListener('visibilitychange', receive)

    function stop() {
        active = false
        clearInterval(timer)
        document.removeEventListener('visibilitychange', receive)
    }

    return { stop }
}
