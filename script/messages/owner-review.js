import { apiJSON, apiRequest, getMessagingSession, listRemoteMessages, setOwnerCredential } from '../storage/portfolio-api.js'
import { escapeHtml } from './content.js'

export function initOwnerReview(existingButton) {
    const button = existingButton ?? document.createElement('button')
    button.type = 'button'
    button.className = 'owner-review-button'
    button.textContent = 'Owner review'
    button.hidden = true
    document.querySelector('.sidebar').append(button)
    const dialog = document.createElement('dialog')
    dialog.className = 'feature-dialog owner-review'
    dialog.setAttribute('aria-label', 'Private message review')
    document.body.append(dialog)
    button.addEventListener('click', () => showReview(dialog))
    getMessagingSession().then(session => {
        button.hidden = !session.owner && !session.localOwner
        if (session.owner && new URLSearchParams(location.search).has('review')) { showReview(dialog) }
    }).catch(() => {})
}

async function showReview(dialog) {
    dialog.innerHTML = '<div class="dialog-heading"><h2>Private messages</h2><button type="button" data-close>×</button></div>'
        + '<p role="status">Loading…</p><div class="review-items"></div>'
    dialog.querySelector('[data-close]').onclick = () => dialog.close()
    if (!dialog.open) { dialog.showModal() }
    try {
        let session = await getMessagingSession()
        if (!session.owner && session.localOwner) {
            const credential = prompt('Local owner token (kept only in memory):')
            if (!credential) { dialog.close(); return }
            setOwnerCredential(credential)
            session = await getMessagingSession(true)
        }
        if (!session.owner) { throw new Error('Sign in with the configured owner account to review private messages.') }
        const [pending, published, rejected] = await Promise.all(['pending', 'published', 'rejected'].map(listRemoteMessages))
        const messages = [...pending, ...published.filter(item => /^(message|reply)-/.test(item.id)), ...rejected]
        const container = dialog.querySelector('.review-items')
        for (const message of messages) { mountReviewItem(container, message) }
        dialog.querySelector('[role="status"]').textContent = messages.length
            ? 'Only approved messages are visible to everyone.' : 'No visitor messages.'
    } catch (error) { dialog.querySelector('[role="status"]').textContent = error.message }
}

function mountReviewItem(container, message) {
    const article = document.createElement('article')
    article.innerHTML = `<h3>${escapeHtml(message.data.subject || '(No subject)')}</h3>
        <p>${escapeHtml(message.from.name)} ${escapeHtml(message.from.email || '')}</p>
        <p class="plain-text">${escapeHtml(message.data.body)}</p><p data-visibility>${escapeHtml(message.visibility)}</p>
        <div class="review-files"></div><div class="review-actions"></div><p role="status"></p>`
    for (const file of message.attachments ?? []) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = file.name
        button.onclick = () => openOwnerAsset(button, `/messages/${message.id}/files/${file.id}`, file.name)
        article.querySelector('.review-files').append(button)
    }
    mountReviewPhotos(article.querySelector('.review-files'), message)
    for (const [state, label] of [['published', 'Approve for everyone'], ['pending', 'Keep private'], ['rejected', 'Reject']]) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = label
        button.onclick = () => moderateItem(article, message, state)
        article.querySelector('.review-actions').append(button)
    }
    container.append(article)
    mountOwnerReply(article, message)
}

function mountReviewPhotos(container, message) {
    function collect(nodes) {
        return (nodes ?? []).flatMap(node => typeof node === 'string' ? []
            : node.tag === 'img' ? [node.photoId] : collect(node.children))
    }
    for (const id of collect(message.data.content)) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = 'View inserted photo'
        button.onclick = () => openOwnerAsset(button, `/messages/${message.id}/photos/${id}`, 'inserted-photo')
        container.append(button)
    }
}

async function openOwnerAsset(button, path, name) {
    button.disabled = true
    try {
        const response = await apiRequest(path, { timeout: 120000 })
        const bytes = await response.blob()
        const extension = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }[bytes.type]
        const url = URL.createObjectURL(bytes)
        const link = document.createElement('a')
        link.href = url
        link.download = name === 'inserted-photo' ? `${name}${extension || ''}` : name
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { button.closest('article').querySelector('[role="status"]').textContent = error.message } finally { button.disabled = false }
}

function mountOwnerReply(article, message) {
    const form = document.createElement('form')
    form.innerHTML = '<label>Private reply<textarea name="body" maxlength="10000" required></textarea></label>'
        + '<button type="submit">Send private reply</button><p role="status"></p>'
    let submission
    form.onsubmit = async event => {
        event.preventDefault()
        const body = form.elements.body.value.trim()
        if (!body) { return }
        if (submission?.body !== body) { submission = { body, id: `reply-${crypto.randomUUID()}` } }
        form.querySelector('button').disabled = true
        try {
            await apiJSON('/messages', { id: submission.id, replyTo: message.id, data: { format: 'text', body } }, { Prefer: 'return=minimal' })
            submission = undefined
            form.reset()
            form.querySelector('[role="status"]').textContent = 'Reply saved privately. The visitor will see it when they revisit.'
        } catch (error) {
            form.querySelector('[role="status"]').textContent = error.message
        } finally { form.querySelector('button').disabled = false }
    }
    article.append(form)
}

async function moderateItem(article, message, visibility) {
    const buttons = article.querySelectorAll('button')
    buttons.forEach(button => { button.disabled = true })
    try {
        const saved = await apiJSON(`/messages/${encodeURIComponent(message.id)}/moderation`, { visibility, version: message.version })
        Object.assign(message, saved)
        article.querySelector('[data-visibility]').textContent = saved.visibility
        article.querySelector('[role="status"]').textContent = 'Saved.'
    } catch (error) {
        article.querySelector('[role="status"]').textContent = error.message
    } finally { buttons.forEach(button => { button.disabled = false }) }
}
