import { loadAttachmentBlob } from '../storage/attachment-storage.js'
import { loadRemoteFile } from '../storage/remote-mailbox.js'
import { escapeHtml } from './content.js'
import { fileSize } from './message-model.js'

export function attachmentCards(items = []) {
    return items
        .map(
            (item) => `<div class="attachment-card">
        <span class="attachment-name">${escapeHtml(item.name)}</span><small>${fileSize(item.size)}</small>
        <button type="button" data-file="${escapeHtml(item.id)}" data-file-action="preview">Open</button>
        <button type="button" data-file="${escapeHtml(item.id)}" data-file-action="download">Download</button>
    </div>`,
        )
        .join('')
}

export function initAttachmentViewer() {
    const dialog = document.createElement('dialog')
    dialog.className = 'file-preview feature-dialog'
    document.body.append(dialog)
    let url = ''
    let previewRequest = 0
    function clearPreview() {
        if (url) { URL.revokeObjectURL(url) }
        url = ''
        dialog.innerHTML = ''
    }
    dialog.addEventListener('close', () => {
        if (!dialog.open) { clearPreview() }
    })
    async function openAttachment(event) {
        const button = event.target.closest('[data-file-action]')
        if (!button || button.disabled) { return }
        button.disabled = true
        const card = button.closest('.attachment-card')
        const request = button.dataset.fileAction === 'preview' ? ++previewRequest : 0
        try {
            const blob = await loadAttachmentBlob(button.dataset.file).catch(() => loadRemoteFile(button.dataset.file))
            if (!card.isConnected || (request && request !== previewRequest)) { return }
            const name = card.querySelector('.attachment-name').textContent
            if (button.dataset.fileAction === 'download') { return downloadBlob(blob, name) }
            const kind = await previewKind(blob)
            if (request !== previewRequest || !card.isConnected) { return }
            showPreview(blob, name, kind)
        } catch (error) {
            reportAttachmentFailure(card, error)
        } finally {
            if (button.isConnected) { button.disabled = false }
        }
    }

    function showPreview(blob, name, kind) {
        if (dialog.open) { dialog.close() }
        clearPreview()
        const preview = kind === 'pdf' ? '<iframe title="PDF attachment preview"></iframe>'
            : kind === 'image' ? '<img class="preview-image" alt="Attachment preview">'
                : '<p>Preview is unavailable for this file type. You can download it instead.</p>'
        dialog.innerHTML = `<div class="dialog-heading"><h2>${escapeHtml(name)}</h2>
            <button type="button" aria-label="Close preview">×</button></div>${preview}
            <button type="button" class="file-download">Download</button>`
        dialog.querySelector('[aria-label="Close preview"]').onclick = () => dialog.close()
        dialog.querySelector('.file-download').onclick = () => downloadBlob(blob, name)
        if (kind) {
            url = URL.createObjectURL(blob)
            dialog.querySelector('iframe, img').src = url
        }
        dialog.showModal()
    }

    document.addEventListener('click', openAttachment)
}

function downloadBlob(blob, name) {
    // Never preview active HTML/SVG under the site's origin; download it as opaque bytes.
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function previewKind(blob) {
    if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(blob.type)) { return 'image' }
    if (blob.type !== 'application/pdf' || !navigator.pdfViewerEnabled) { return '' }
    return new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer()) === '%PDF-' ? 'pdf' : ''
}

function reportAttachmentFailure(card, error) {
    let status = card.querySelector('[role="alert"]')
    if (!status) {
        status = document.createElement('span')
        status.setAttribute('role', 'alert')
        card.append(status)
    }
    status.textContent = error.message
}
