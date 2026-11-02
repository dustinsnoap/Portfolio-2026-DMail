import { apiJSON, getMessagingSession, messagingConfigured } from '../storage/portfolio-api.js'
import { contentHtml, contentText, escapeHtml, readContent } from './content.js'
import { announceEditor } from './editor-status.js'

// Send only draft text to cleanup; preserve links and photos as opaque local markers.
export function cleanupDraft(content) {
    const prefix = `[[dmail:${crypto.randomUUID()}:`
    const assets = new Map()
    function protect(nodes) {
        return nodes.map(node => {
            if (typeof node === 'string') { return node }
            if (node.tag === 'a' || node.tag === 'img') {
                const token = `${prefix}${assets.size}]]`
                assets.set(token, contentHtml([node]))
                return token
            }
            return { ...node, children: protect(node.children ?? []) }
        })
    }
    const text = contentText(protect(content)).trim()
    if (!text || text.length > 10000) { throw new Error('Use between 1 and 10,000 characters for AI cleanup.') }
    return { text, assets }
}

// Treat model output as text; restore each original link/photo at most once.
export function cleanupHtml(text, draft) {
    if (typeof text !== 'string' || !text.trim() || text.length > 10000) { throw new Error('AI returned an invalid draft.') }
    for (const token of text.match(/\[\[dmail:[\w-]+:\d+\]\]/g) ?? []) {
        if (!draft.assets.has(token)) { throw new Error('AI changed a protected link or photo. Your draft has not changed.') }
    }
    let html = escapeHtml(text.trim()).replace(/\n/g, '<br>')
    for (const [token, asset] of draft.assets) {
        if (text.split(token).length !== 2) { throw new Error('AI changed a protected link or photo. Your draft has not changed.') }
        html = html.replace(token, () => asset)
    }
    return html
}

export function mountDraftCleanup(root, { replace, update }) {
    const input = root.querySelector('.editor-body')
    const clean = root.querySelector('[data-action="clean-draft"]')
    const undo = root.querySelector('[data-action="undo-cleanup"]')
    const microphone = root.querySelector('[data-action="dictate"]')
    let pending = false
    let snapshot = null

    function announce(text, error = false) { announceEditor(root, text, 'cleanup', error) }

    function refresh() {
        if (!pending && snapshot && input.innerHTML !== snapshot.after) {
            snapshot = null
            announce('')
        }
        const recording = Boolean(root.dataset.dictating)
        const cleaned = Boolean(snapshot && input.innerHTML === snapshot.after)
        clean.hidden = cleaned
        clean.disabled = !messagingConfigured() || pending || recording || !input.textContent.trim()
        if (!messagingConfigured()) { clean.title = 'AI cleanup is available on the live portfolio.' }
        undo.hidden = !cleaned
        undo.disabled = pending || recording
        undo.title = 'Restore the draft before cleanup'
        if (pending) { microphone.disabled = true } else if (microphone.title === 'Start dictation') { microphone.disabled = false }
    }

    async function run() {
        if (pending || root.dataset.dictating || clean.hidden || !input.textContent.trim()) { return }
        const before = input.innerHTML
        try {
            const draft = cleanupDraft(readContent(input))
            pending = true
            root.dataset.cleaning = 'true'
            update()
            announce('Cleaning up your draft… You can keep editing.')
            await getMessagingSession()
            const result = await apiJSON('/dictation/cleanup', { text: draft.text, consent: true })
            if (!root.isConnected) { return }
            if (input.innerHTML !== before) {
                announce('Your draft changed during cleanup. Run cleanup again to use the latest text.')
                return
            }
            const html = cleanupHtml(result.text, draft)
            const template = document.createElement('template')
            template.innerHTML = html
            readContent(template.content)
            if (!replace(html)) { throw new Error('Could not apply cleanup. Your original draft is still here.') }
            snapshot = { before, after: input.innerHTML }
            announce('Draft cleaned up. Review it before sending, or undo the cleanup.')
        } catch (error) {
            if (root.isConnected) { announce(error.message || 'Cleanup failed. Your draft has not changed.', true) }
        } finally {
            pending = false
            delete root.dataset.cleaning
            if (root.isConnected) { update() }
        }
    }

    function restore() {
        if (!snapshot || pending || root.dataset.dictating || input.innerHTML !== snapshot.after) { return }
        if (!replace(snapshot.before)) { return }
        snapshot = null
        announce('Original draft restored.')
        update()
    }

    root.closest('form')?.addEventListener('submit', event => {
        if (!pending) { return }
        event.preventDefault()
        event.stopImmediatePropagation()
    }, true)
    return { refresh, handle: action => action === 'clean-draft' ? run() : restore() }
}
