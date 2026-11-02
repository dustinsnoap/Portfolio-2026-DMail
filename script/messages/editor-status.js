// A stale feature must not clear a newer feature's status message.
export function announceEditor(root, text, source = 'editor', error = false) {
    const status = root.querySelector('.editor-status')
    const currentSource = status.dataset.source
    if (!text && currentSource !== source) { return }
    if (status.textContent === text && currentSource === source && status.dataset.error === String(error)) { return }
    status.textContent = text
    status.title = text
    status.dataset.source = source
    status.dataset.error = String(error)
}
