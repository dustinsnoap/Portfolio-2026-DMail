import { messagingConfigured } from '../storage/portfolio-api.js'
import { announceEditor } from './editor-status.js'

let active = null

export function dictatedText(before, text) {
    const words = text.trim()
    return words && before && !/\s$/.test(before) && !/^[.,!?;:)]/.test(words) ? ' ' + words : words
}

// Do not request microphone access or load the speech model until dictation is activated.
export function mountDictation(root, { rememberSelection, restoreSelection, command, update }) {
    const button = root.querySelector('[data-action="dictate"]')
    if (!messagingConfigured()) {
        button.disabled = true
        button.title = 'Dictation is available on the live portfolio.'
        return { cancel: () => {}, toggle: () => announceEditor(root, button.title, 'dictation') }
    }
    const input = root.querySelector('.editor-body')
    const form = root.closest('form')
    let controller = null
    let capture = null
    let preview = null
    let observer = null
    let timeout = null
    let waiting = false
    let inserted = false

    function announce(text) { announceEditor(root, text, 'dictation') }

    function provisional(text = '') {
        preview?.remove()
        preview = null
        if (!text || !root.isConnected) { return }
        restoreSelection()
        const range = window.getSelection().getRangeAt(0).cloneRange()
        range.collapse(false)
        preview = document.createElement('span')
        preview.dataset.dictationPreview = ''
        preview.contentEditable = 'false'
        preview.setAttribute('aria-hidden', 'true')
        preview.textContent = ' ' + text
        range.insertNode(preview)
    }

    function commit(text) {
        provisional()
        if (!text?.trim() || !root.isConnected) { return }
        restoreSelection()
        const range = window.getSelection().getRangeAt(0)
        const before = document.createRange()
        before.selectNodeContents(input)
        before.setEnd(range.startContainer, range.startOffset)
        if (!command('insertText', dictatedText(before.toString(), text))) {
            throw new Error('Dictation stopped. Keep the message under 10,000 characters.')
        }
        inserted = true
    }

    function finishSpacing() {
        if (!inserted) { return }
        restoreSelection()
        const after = window.getSelection().getRangeAt(0).cloneRange()
        after.collapse(false)
        after.setEnd(input, input.childNodes.length)
        if (after.toString() && !/^[\s.,!?;:)]/.test(after.toString())) { command('insertText', ' ') }
    }

    function cancel() { provisional(); controller?.abort() }

    function stop() {
        if (!controller || waiting) { return }
        if (!capture) { cancel(); return }
        waiting = true
        button.disabled = true
        announce('Finishing dictation…')
        capture.stop()
        timeout = setTimeout(() => controller?.abort(new Error('Dictation timed out. Confirmed words are still here.')), 90000)
    }

    function checkVisibility() {
        if (!root.isConnected || !root.checkVisibility() || root.closest('[inert]')) { cancel() }
    }

    function hide() { if (document.hidden) { cancel() } }

    function guardSubmit(event) {
        if (!controller) { return }
        event.preventDefault()
        event.stopImmediatePropagation()
        stop()
    }

    function cleanup() {
        provisional()
        observer?.disconnect()
        clearTimeout(timeout)
        window.removeEventListener('pagehide', cancel)
        document.removeEventListener('visibilitychange', hide)
        input.removeEventListener('pointerdown', cancel)
        input.removeEventListener('beforeinput', cancelTyping, true)
        form?.removeEventListener('submit', guardSubmit, true)
        root.removeEventListener('keydown', escape)
        delete root.dataset.dictating
        button.disabled = false
        button.setAttribute('aria-label', 'Start dictation')
        button.title = 'Start dictation'
        button.setAttribute('aria-pressed', 'false')
        controller = null
        capture = null
        waiting = false
        if (active === cancel) { active = null }
        update()
    }

    function cancelTyping(event) { if (event.isTrusted) { cancel() } }

    function escape(event) {
        if (event.key !== 'Escape') { return }
        event.preventDefault()
        event.stopPropagation()
        stop()
    }

    async function toggle() {
        if (controller) { stop(); return }
        active?.()
        active = cancel
        inserted = false
        controller = new AbortController()
        const signal = controller.signal
        rememberSelection()
        root.dataset.dictating = 'loading'
        button.setAttribute('aria-pressed', 'true')
        button.setAttribute('aria-label', 'Stop dictation')
        button.title = 'Stop dictation'
        announce('Loading speech recognition…')
        update()
        window.addEventListener('pagehide', cancel)
        document.addEventListener('visibilitychange', hide)
        input.addEventListener('pointerdown', cancel)
        input.addEventListener('beforeinput', cancelTyping, true)
        root.addEventListener('keydown', escape)
        form?.addEventListener('submit', guardSubmit, true)
        observer = new MutationObserver(checkVisibility)
        // Observe visibility changes only; typing must not stop or restart dictation.
        const visibilityOptions = { childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'inert', 'style'] }
        for (let ancestor = root; ancestor; ancestor = ancestor.parentElement) {
            observer.observe(ancestor, visibilityOptions)
        }
        let speech
        try {
            const [{ createSpeechSession }, { captureSpeech }, { createPhraseRecognizer }] = await Promise.all([
                import('./speech-session.js'),
                import('./speech-capture.js'),
                import('./speech-phrases.js'),
            ])
            signal.throwIfAborted()
            speech = createSpeechSession(signal, percentage => announce(`Loading speech recognition… ${Math.round(percentage)}%`))
            await speech.ready
            signal.throwIfAborted()
            announce('Allow microphone access to dictate.')
            capture = await captureSpeech(signal, stop)
            root.dataset.dictating = 'listening'
            announce('Listening… Audio stays on this device.')
            const phrases = createPhraseRecognizer(speech, seconds => {
                if (!waiting) {
                    announce(seconds === 1 ? 'Listening… Audio stays on this device.'
                        : 'Listening… Previews may lag while dictation catches up. Pause for the final text.')
                }
            })
            for await (const samples of capture.chunks) {
                const part = await phrases.process(samples, !waiting && !capture.pending)
                if (!part) { continue }
                signal.throwIfAborted()
                commit(part.text)
                provisional(part.pending)
            }
            const tail = await phrases.finish()
            signal.throwIfAborted()
            commit(tail?.text)
            finishSpacing()
            if (!inserted) {
                const { received, peak } = capture.signal
                if (!received) {
                    announce('No microphone audio arrived. Check your input device and try again.')
                } else if (peak < .0001) {
                    announce('The microphone is sending silence. Check your selected input and mute switch.')
                } else { announce('Audio was captured, but no words were recognized. Try speaking closer to the microphone.') }
                return
            }
            announce(capture.limited
                ? 'Dictation paused to catch up. Review your text, then start the microphone again to continue.'
                : 'Dictation finished. Review your message before sending.')
        } catch (error) {
            if (signal.aborted) { error = signal.reason }
            if (error.name === 'NotAllowedError') {
                announce('Microphone access is blocked. Allow it in your browser’s site settings, then try again. ' +
                    'If no permission prompt appears, open DMail in Edge or Chrome and check Windows microphone privacy settings.')
            } else if (error.name === 'NotFoundError') {
                announce('No microphone was found. You can keep typing.')
            } else if (error.name !== 'AbortError') {
                announce(error.message || 'Dictation is unavailable. You can keep typing.')
            } else { announce('Dictation stopped. Your confirmed words are still here.') }
        } finally {
            speech?.close()
            controller?.abort()
            cleanup()
        }
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.WebAssembly || !window.isSecureContext) {
        button.disabled = true
        button.title = 'Dictation needs a supported browser on HTTPS or localhost.'
    }
    return { toggle, cancel }
}
