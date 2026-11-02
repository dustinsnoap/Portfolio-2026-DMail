import { getReplyRecipient } from '../mailbox/state.js'
import { escapeHtml } from './content.js'
import { buildEditor, mountEditor, readEditor, readEditorAttachments } from './editor.js'
import { buildSenderField } from './message-model.js'

export function renderReplyForm(messageId, body = [], onChange, attachments = [], senderName = '') {
    const recipient = getReplyRecipient()
    const mail = document.querySelector('.mail')
    mail.querySelector('.reply-form')?.remove()
    const footer = mail.querySelector('.thread-footer')
    footer.insertAdjacentHTML(
        'beforebegin',
        `
        <form class="reply-form" data-id="${escapeHtml(messageId)}" aria-label="Reply">
            ${buildSenderField(senderName)}
            <div class="reply-recipient">
                <svg><use href="/api/portfolio/assets/img/sprites.svg#icon-arrow-curved" /></svg>
                <span>To: ${escapeHtml(recipient.name)}</span>
            </div>
            ${buildEditor('Reply message', { placeholder: 'Write your reply…', discardLabel: 'Discard reply' })}
        </form>`,
    )
    footer.hidden = true
    const form = mail.querySelector('.reply-form')
    const editor = form.querySelector('.message-editor')
    const sender = form.elements.senderName
    function updateSender() {
        onChange?.(readEditor(editor), readEditorAttachments(editor), sender.value)
    }

    sender.addEventListener('input', updateSender)
    function updateDraft(content, files) {
        onChange?.(content, files, sender.value)
    }

    mountEditor(editor, { body, attachments, onChange: updateDraft })
    form.scrollIntoView({ block: 'nearest' })
}
