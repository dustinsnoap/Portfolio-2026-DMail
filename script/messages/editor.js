import { contentHtml, contentText, escapeHtml, readContent, safeLink } from './content.js'
import { mountDictation } from './dictation.js'
import { mountDraftCleanup } from './draft-cleanup.js'
import { buildEditor, emojiPanel, linkPanel, photoPanel, TEMPLATES, writePanel } from './editor-markup.js'
import { announceEditor } from './editor-status.js'
import { fileSize, filesToAttachments, normalizeAttachments } from './message-model.js'

export { buildEditor }
const editorAttachments = new WeakMap()
export function readEditorAttachments(root) {
    return editorAttachments.get(root) ?? []
}

export function readEditor(root) {
    return readContent(root.querySelector('.editor-body'))
}

export function setEditorBusy(root, busy) {
    root.querySelector('.editor-body').contentEditable = String(!busy)
    root.querySelectorAll('button, select, input, textarea').forEach((control) => {
        control.disabled = busy
    })
    root.setAttribute('aria-busy', String(busy))
}

function attachmentMarkup(item) {
    const name = escapeHtml(item.name)
    return `<div class="editor-file"><span>${name}</span><small>${fileSize(item.size)}</small>
        <button type="button" data-action="remove-file" data-id="${escapeHtml(item.id)}" aria-label="Remove ${name}">×</button></div>`
}

export function mountEditor(root, { body = [], attachments = [], onChange = () => {} } = {}) {
    const input = root.querySelector('.editor-body')
    const panel = root.querySelector('.editor-panel')
    const send = root.querySelector('.editor-send')
    const formatButtons = [...root.querySelectorAll('.editor-format [aria-pressed]')]
    let changeVersion = 0
    let selection = null
    let panelTrigger = null
    let readingPhoto = false
    let cleanup = null
    let fallbackUndo = null
    editorAttachments.set(root, normalizeAttachments(attachments))
    input.innerHTML = typeof body === 'string' ? escapeHtml(body).replace(/\n/g, '<br>') : contentHtml(body)

    function rememberSelection() {
        const current = window.getSelection()
        if (current.rangeCount && input.contains(current.anchorNode) && input.contains(current.focusNode)) {
            selection = current.getRangeAt(0).cloneRange()
        }
    }

    function restoreSelection() {
        input.focus({ preventScroll: true })
        const current = window.getSelection()
        current.removeAllRanges()
        if (!selection || !input.contains(selection.commonAncestorContainer)) {
            selection = document.createRange()
            selection.selectNodeContents(input)
            selection.collapse(false)
        }
        current.addRange(selection)
    }

    function announce(text) { announceEditor(root, text, 'editor', Boolean(text)) }

    function update() {
        cleanup?.refresh()
        changeVersion++
        try {
            const content = readEditor(root)
            send.disabled = Boolean(root.dataset.dictating || root.dataset.cleaning) || readingPhoto ||
                (!contentText(content).trim() && !readEditorAttachments(root).length)
            announce('')
            onChange(content, readEditorAttachments(root))
        } catch (error) {
            send.disabled = true
            announce(error.message)
        }
    }

    function setAttachments(items) {
        editorAttachments.set(root, normalizeAttachments(items))
        renderAttachments()
        update()
    }

    function renderAttachments() {
        root.querySelector('.editor-attachments').innerHTML = readEditorAttachments(root).map(attachmentMarkup).join('')
    }

    function command(name, value = null) {
        restoreSelection()
        if (name === 'insertText' || name === 'insertHTML') {
            const fragment = document.createElement('template')
            if (name === 'insertHTML') { fragment.innerHTML = value }
            const length = name === 'insertHTML' ? fragment.content.textContent.length : value.length
            if (input.textContent.length - selection.toString().length + length > 10000) {
                announce('Keep the message under 10,000 characters.')
                return false
            }
        }
        const insertion = name === 'insertText' || name === 'insertHTML'
        const supported = document.queryCommandSupported(name)
        if (!supported && !insertion) {
            announce('This formatting option is unavailable in your browser.')
            return false
        }
        const previousVersion = changeVersion
        const before = input.innerHTML
        // Native commands preserve undo history, but their success return value is not reliable.
        const applied = supported && document.execCommand(name, false, value)
        if (input.innerHTML === before && (insertion || !applied)) {
            if (!insertion || !insertAtSelection(name, value, before)) { return false }
        }
        rememberSelection()
        if (changeVersion === previousVersion) { update() }
        updateFormatting()
        return true
    }

    // Some browsers reject asynchronous insertion; fall back to the saved DOM range.
    function insertAtSelection(name, value, before) {
        if (!input.isContentEditable || !root.isConnected) { return false }
        restoreSelection()
        const range = window.getSelection().getRangeAt(0)
        const template = document.createElement('template')
        template.innerHTML = name === 'insertText' ? escapeHtml(value).replace(/\n/g, '<br>') : value
        const last = template.content.lastChild
        range.deleteContents()
        if (last) { range.insertNode(template.content); range.setStartAfter(last) }
        range.collapse(true)
        const current = window.getSelection()
        current.removeAllRanges()
        current.addRange(range)
        // Keep one manual undo point when native insertion cannot create an undo entry.
        fallbackUndo = { before, after: input.innerHTML }
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
    }

    function undoFallback(event) {
        if (!fallbackUndo || event.key.toLowerCase() !== 'z' || event.shiftKey || !(event.ctrlKey || event.metaKey)) { return }
        if (root.dataset.dictating) { dictation.cancel() }
        if (input.innerHTML !== fallbackUndo.after) { return }
        event.preventDefault()
        event.stopPropagation()
        input.innerHTML = fallbackUndo.before
        fallbackUndo = null
        selection = null
        restoreSelection()
        update()
        updateFormatting()
    }

    function updateFormatting() {
        for (const button of formatButtons) {
            button.setAttribute('aria-pressed', String(document.queryCommandState(button.dataset.action)))
        }
    }

    function closePanel(focus = false) {
        panel.hidden = true
        if (panelTrigger) {
            panelTrigger.setAttribute('aria-expanded', 'false')
            if (focus) { panelTrigger.focus() }
        }
        panelTrigger = null
    }

    function openPanel(trigger, html) {
        const same = panelTrigger === trigger && !panel.hidden
        closePanel()
        if (same) { return }
        panelTrigger = trigger
        panel.innerHTML = html
        panel.hidden = false
        trigger.setAttribute('aria-expanded', 'true')
        panel.querySelector('input, textarea, button')?.focus({ preventScroll: true })
        panel.scrollIntoView({ block: 'nearest' })
    }

    function limitInsertedText(event) {
        if (!event.data || !event.inputType.startsWith('insert')) { return }
        const selected = window.getSelection()?.toString().length ?? 0
        if (input.textContent.length - selected + event.data.length > 10000) {
            event.preventDefault()
            announce('Keep the message under 10,000 characters.')
        }
    }

    function pastePlainText(event) {
        event.preventDefault()
        rememberSelection()
        const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
        command('insertHTML', escapeHtml(text).replace(/\n/g, '<br>'))
    }

    function addAttachments(files) {
        try {
            setAttachments([...readEditorAttachments(root), ...filesToAttachments(files)])
        } catch (error) {
            announce(error.message)
        }
    }

    function dropAttachments(event) {
        event.preventDefault()
        addAttachments(event.dataTransfer.files)
    }

    function rememberToolSelection(event) {
        if (!input.contains(event.target) && !panel.contains(event.target)) { rememberSelection() }
        if (event.target.closest('[data-action]') && !panel.contains(event.target)) { event.preventDefault() }
    }

    function handlePanelKeys(event) {
        if (event.key === 'Escape' && !panel.hidden) {
            event.preventDefault()
            closePanel(true)
        }
        if (event.key === 'Enter' && event.target.closest('.editor-panel') && event.target.tagName === 'INPUT') {
            event.preventDefault()
            panel.querySelector('[data-action="apply-link"], [data-action="insert-template"]')?.click()
        }
    }

    function removeAttachment(button) {
        setAttachments(readEditorAttachments(root).filter((item) => item.id !== button.dataset.id))
    }

    function toggleFormatting(button) {
        const bar = root.querySelector('.editor-format')
        bar.hidden = !bar.hidden
        button.setAttribute('aria-expanded', String(!bar.hidden))
        button.setAttribute('aria-pressed', String(!bar.hidden))
        root.scrollIntoView({ block: 'nearest' })
    }

    function insertLink(button) {
        const value = panel.querySelector('[name="link-url"]').value.trim()
        const href = safeLink(value) || safeLink(value.includes('@') ? `mailto:${value}` : `https://${value}`)
        if (!href || (/^[\w-]+:/.test(value) && !safeLink(value))) {
            panel.querySelector('.panel-status').textContent = 'Enter a valid web or email address.'
            return
        }
        const text = panel.querySelector('[name="link-text"]').value.trim() || href
        closePanel()
        command('insertHTML', `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`)
    }

    function insertEmoji(button) {
        closePanel()
        command('insertText', button.dataset.emoji)
    }

    function openTemplatePanel(button) {
        openPanel(button, writePanel())
        if (!panel.hidden) { panel.querySelector('textarea').value = TEMPLATES.introduction }
    }

    function insertTemplate(button) {
        const text = panel.querySelector('textarea').value
        closePanel()
        // Templates append to the draft rather than replacing its current selection.
        selection = null
        const prefix = contentText(readEditor(root)).trim() ? '<br><br>' : ''
        command('insertHTML', prefix + escapeHtml(text).replace(/\n/g, '<br>'))
    }

    // Reset the picker so choosing the same attachment again still emits a change event.
    function addPickedAttachments(control) {
        addAttachments(control.files)
        control.value = ''
    }

    function applyFormattingControl(control) {
        const name = control.dataset.command === 'alignment' ? control.value : control.dataset.command
        command(name, control.dataset.command === 'alignment' ? null : control.value)
    }

    function updateTemplatePreview(control) {
        panel.querySelector('textarea').value = TEMPLATES[control.value]
    }

    function finishPhotoRead(control) {
        readingPhoto = false
        control.value = ''
        if (!root.isConnected) { return }
        try {
            send.disabled = Boolean(root.dataset.dictating || root.dataset.cleaning) ||
                (!contentText(readEditor(root)).trim() && !readEditorAttachments(root).length)
        } catch (error) {
            send.disabled = true
            announce(error.message)
        }
    }

    async function insertSelectedPhoto(control) {
        try {
            readingPhoto = true
            send.disabled = true
            const photo = await readPhoto(control.files[0], panel, input)
            if (!root.isConnected) { return }
            closePanel()
            command('insertHTML', contentHtml([photo]) + '<br>')
        } catch (error) {
            announce(error.message)
        } finally {
            finishPhotoRead(control)
        }
    }

    function handleToolClick(event) {
        const button = event.target.closest('[data-action]')
        if (!button || button.disabled) { return }
        const action = button.dataset.action
        if (action === 'dictate') { closePanel(); return dictation.toggle() }
        if (action === 'clean-draft' || action === 'undo-cleanup') { return cleanup.handle(action) }
        if (action === 'discard') { return }
        if (action === 'attach') { return root.querySelector('.attachment-picker').click() }
        if (action === 'remove-file') { return removeAttachment(button) }
        if (action === 'format') { return toggleFormatting(button) }
        if (action === 'close-panel') { return closePanel(true) }
        if (action === 'link') { return openPanel(button, linkPanel(selection?.toString() ?? '')) }
        if (action === 'apply-link') { return insertLink(button) }
        if (action === 'emoji') { return openPanel(button, emojiPanel()) }
        if (action === 'insert-emoji') { return insertEmoji(button) }
        if (action === 'photo') { return openPanel(button, photoPanel()) }
        if (action === 'write') { return openTemplatePanel(button) }
        if (action === 'insert-template') { return insertTemplate(button) }
        closePanel()
        command(action === 'quote' ? 'formatBlock' : action, action === 'quote' ? 'blockquote' : null)
    }

    async function handleControlChange(event) {
        const control = event.target
        if (control.classList.contains('attachment-picker')) { return addPickedAttachments(control) }
        if (control.dataset.command) { return applyFormattingControl(control) }
        if (control.matches('[aria-label="Writing template"]')) { return updateTemplatePreview(control) }
        if (control.type !== 'file' || !control.files[0]) { return }
        return insertSelectedPhoto(control)
    }

    function refreshSelectionState() {
        rememberSelection()
        updateFormatting()
    }

    function bindInputEvents() {
        input.addEventListener('beforeinput', limitInsertedText)
        input.addEventListener('keydown', undoFallback)
        input.addEventListener('input', update)
        input.addEventListener('keyup', refreshSelectionState)
        input.addEventListener('mouseup', refreshSelectionState)
        input.addEventListener('blur', rememberSelection)
        input.addEventListener('paste', pastePlainText)
        input.addEventListener('drop', dropAttachments)
        input.addEventListener('focus', () => closePanel())
    }

    function bindToolEvents() {
        root.addEventListener('pointerdown', rememberToolSelection)
        root.addEventListener('keydown', handlePanelKeys)
        root.addEventListener('click', handleToolClick)
        root.addEventListener('change', handleControlChange)
    }

    cleanup = mountDraftCleanup(root, { update, replace: html => {
        selection = document.createRange()
        selection.selectNodeContents(input)
        return command('insertHTML', html)
    } })
    const dictation = mountDictation(root, { rememberSelection, restoreSelection, command, update })
    bindInputEvents()
    bindToolEvents()
    renderAttachments()
    update()
    input.focus({ preventScroll: true })
}

function fileDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('Could not read this photo. Please try again.'))
        reader.readAsDataURL(file)
    })
}

function validatePhoto(file, input) {
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || file.size > 500000) {
        throw new TypeError('Choose a PNG, JPEG, GIF, or WebP photo under 500 KB.')
    }
    if (input.querySelectorAll('img').length >= 3) { throw new TypeError('Use up to three photos per message.') }
}

export async function readPhoto(file, panel, input) {
    validatePhoto(file, input)
    const alt = panel.querySelector('[name="photo-alt"]').value.trim() || file.name
    return { tag: 'img', src: await fileDataUrl(file), alt }
}
