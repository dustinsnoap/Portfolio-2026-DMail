import { portfolioAvatar } from '../account/account-avatar.js'
import { spriteIcon } from '../app/icons.js'
import { attachmentCards } from './attachments.js'
import { contentHtml, escapeHtml } from './content.js'
import { contactLabel, isPortfolioOwner } from './message-model.js'
import { syncIndicator } from './message-sync.js'
import { timestampMarkup } from './timestamps.js'

export function buildMessageContent(email) {
    const { format, body } = email.data
    if (format === 'rich') { return `<div class="message-content rich-content">${contentHtml(body)}</div>` }
    const content = format === 'text' ? escapeHtml(body) : body ?? ''
    return `<div class="message-content${format === 'text' ? ' plain-text' : ''}">${content}</div>`
}

export function buildThreadHeader(folder = '') {
    const deleting = folder === 'trash' ? 'Delete forever' : 'Delete'
    const action = folder === 'trash' ? 'delete-forever' : 'trash'

    return (
        `
        <header class="thread-header">
            <button class="thread-action back" aria-label="Back to conversations">
                <svg>
                    <use href="/api/portfolio/assets/img/sprites.svg#icon-arrow" /></svg></button>
            <button class="thread-action" data-mail-action="${folder === 'archive' ? 'restore' : 'archive'}"
                aria-label="${folder === 'archive' ? 'Restore conversation' : 'Archive'}"
                title="${folder === 'archive' ? 'Restore to original location' : 'Archive'}"
                ${['spam', 'trash', 'drafts'].includes(folder) ? 'hidden' : ''}>
                <svg viewBox="0 0 24 24"><use href="/api/portfolio/assets/img/sprites.svg#archive" /></svg></button>
            <button class="thread-action" data-mail-action="${folder === 'spam' ? 'restore' : 'spam'}"
                aria-label="${folder === 'spam' ? 'Not spam' : 'Mark as spam'}" title="${folder === 'spam' ? 'Not spam' : 'Mark as spam'}">
                <svg><use href="/api/portfolio/assets/img/sprites.svg#icon-spam" /></svg></button>
            <button class="thread-action" data-mail-action="${action}" aria-label="${deleting}" title="${deleting}">
                <svg><use href="/api/portfolio/assets/img/sprites.svg#icon-trash" /></svg></button>
            ${folder === 'trash' ? '<button class="thread-action" data-mail-action="restore" aria-label="Restore conversation">' +
                '<svg><use href="/api/portfolio/assets/img/sprites.svg#icon-inbox-inactive" /></svg></button>' : ''}
            <button class="thread-action" data-mail-action="unread" aria-label="Mark as unread" title="Mark as unread">
                <svg><use href="/api/portfolio/assets/img/sprites.svg#icon-unread" /></svg></button>
            <button type="button" class="thread-action apply-labels" aria-label="Apply labels" title="Apply labels">
                ${spriteIcon('label')}
            </button>
        </header>`
    )
}

export function buildThreadEmail(email, expanded) {
    return (
        `
        <article class="message${expanded ? '' : ' collapsed'}" data-id="${escapeHtml(email.id)}" data-body-ready="${expanded}"
                data-auto-expanded="${expanded}">
            <img class="avatar" src="${escapeHtml(portfolioAvatar(email.from.avatar))}" alt="" />
            <div class="message-head">
                <div class="contacts">
                    <div class="sender">
                        <span class="name">${escapeHtml(email.from.name)}</span>
                        ${senderAddress(email.from)}
                    </div>
                    <span class="recipient">${buildRecipients(email)}</span>
                </div>
                ${timestampMarkup(email.timestamp)}
                <div class="actions">
                    <span data-sync-status="${escapeHtml(email.id)}">${syncIndicator(email)}</span>
                    <button class="icon star${email.status.starred ? ' starred' : ''}">
                        <svg class="inactive"><use href="/api/portfolio/assets/img/sprites.svg#icon-star-inactive" /></svg>
                        <svg class="active"><use href="/api/portfolio/assets/img/sprites.svg#icon-star-active" /></svg>
                    </button>
                    <button class="icon reply" aria-label="Reply">
                        <svg><use href="/api/portfolio/assets/img/sprites.svg#icon-arrow-curved"/></svg>
                    </button>
                    <button class="icon options-toggle" aria-label="Message options" aria-expanded="false">
                        <svg><use href="/api/portfolio/assets/img/sprites.svg#icon-options"/></svg>
                    </button>
                </div>
            </div>
            <div class="message-body">
                <p class="message-summary">${escapeHtml(email.data.summary)}</p>
                ${expanded ? buildMessageContent(email) : ''}
            </div>
            <div class="message-attachments">${expanded ? attachmentCards(email.attachments) : ''}</div>
            <div class="options hidden" popover="manual" role="group" aria-label="Message options" inert>
                <button class="icon reply">
                    <svg><use href="/api/portfolio/assets/img/sprites.svg#icon-arrow-curved"/></svg>
                    <span>Reply</span>
                </button>
                <button class="icon forward">
                    <svg class="flip-horizontal"><use href="/api/portfolio/assets/img/sprites.svg#icon-arrow-curved"/></svg>
                    <span>Forward</span>
                </button>
                <button class="icon delete" data-mail-action="${email.mailboxFolder === 'trash' ? 'delete-forever' : 'trash'}">
                    <svg><use href="/api/portfolio/assets/img/sprites.svg#icon-trash"/></svg>
                    <span>${email.mailboxFolder === 'trash' ? 'Delete forever' : 'Delete'}</span>
                </button>
                <button class="icon mark-unread" data-mail-action="unread">
                    <svg><use href="/api/portfolio/assets/img/sprites.svg#icon-unread"/></svg>
                    <span>Mark as unread</span>
                </button>
                <button class="icon report-spam" data-mail-action="${email.mailboxFolder === 'spam' ? 'restore' : 'spam'}">
                    <svg><use href="/api/portfolio/assets/img/sprites.svg#icon-spam"/></svg>
                    <span>${email.mailboxFolder === 'spam' ? 'Not spam' : 'Mark as spam'}</span>
                </button>
            </div>
        </article>`
    )
}

function buildRecipients(email) {
    if (!email.recipients) { return `to ${escapeHtml(email.to?.name ?? 'me')}` }
    return ['to', 'cc', 'bcc']
        .filter((field) => email.recipients[field].length)
        .map((field) => `${field} ${email.recipients[field].map((recipient) => escapeHtml(contactLabel(recipient))).join(', ')}`)
        .join('; ')
}

export function buildThreadFooter() {
    return (
        `
        <div class="thread-footer">
            <button class="thread-reply"><svg><use href="/api/portfolio/assets/img/sprites.svg#icon-arrow-curved" /></svg>Reply</button>
            <button class="thread-forward">
                <svg class="flip-horizontal">
                    <use href="/api/portfolio/assets/img/sprites.svg#icon-arrow-curved" /></svg>Forward</button>
        </div>`
    )
}

function senderAddress(person) {
    if (!person.email || isPortfolioOwner(person)) { return '' }
    return `<span class="email">&lt;${escapeHtml(person.email)}&gt;</span>`
}
