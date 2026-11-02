import { keyboardAction } from '../navigation/keyboard-shortcuts.js'
import { getGeneralPreferences } from '../settings/general-preferences.js'
import { buildSearchQuery } from './search.js'

export function initSearch({ onSearch }) {
    const form = document.querySelector('.searchbar')
    const input = form.querySelector('.searchbox')
    const clear = form.querySelector('.search-clear')
    const toggle = form.querySelector('.settings')
    const options = document.querySelector('.search-options')
    let timer = null
    let composing = false
    let optionsRequest
    let optionsReady = false
    let optionsGeneration = 0

    function apply(notify = true) {
        clearTimeout(timer)
        timer = null
        clear.hidden = !input.value
        if (notify) { onSearch(input.value) }
    }

    function closeOptions() {
        optionsGeneration++
        options.hidden = true
        options.removeAttribute('aria-busy')
        toggle.setAttribute('aria-expanded', 'false')
    }

    // Retain the live scope node because existing search listeners still reference it.
    async function loadOptions() {
        if (optionsReady) { return }
        optionsRequest ??= import('./search-options-template.js').then(({ default: markup }) => {
            const scope = options.querySelector('.search-scope')
            options.innerHTML = markup
            options.querySelector('.search-scope').replaceWith(scope)
            optionsReady = true
        }).catch(error => { optionsRequest = null; throw error })
        return optionsRequest
    }

    // Ignore late content if the panel was closed or another opening replaced it.
    async function openOptions({ field = 'query', operator = '' } = {}) {
        const reset = options.hidden || !optionsReady
        const generation = ++optionsGeneration
        options.hidden = false
        toggle.setAttribute('aria-expanded', 'true')
        options.setAttribute('aria-busy', 'true')
        options.querySelector('.search-options-error').textContent = optionsReady ? '' : 'Loading search options…'
        try {
            await loadOptions()
            if (generation !== optionsGeneration || options.hidden) { return }
            if (reset) {
                options.reset()
                options.elements.query.value = input.value
            }
            if (operator && !options.elements.query.value.includes(operator)) { options.elements.query.value += ' ' + operator }
            options.querySelector('.search-options-error').textContent = ''
            options.elements[field].focus()
        } catch {
            if (generation === optionsGeneration) {
                options.querySelector('.search-options-error').textContent = 'Search options could not load. Close and try again.'
            }
        } finally {
            if (generation === optionsGeneration) { options.removeAttribute('aria-busy') }
        }
    }

    input.addEventListener('input', () => {
        clear.hidden = !input.value
        clearTimeout(timer)
        if (!composing) { timer = setTimeout(apply, 120) }
    })
    input.addEventListener('compositionstart', () => {
        composing = true
        clearTimeout(timer)
    })
    input.addEventListener('compositionend', () => {
        composing = false
        apply()
    })
    form.addEventListener('submit', (event) => {
        event.preventDefault()
        closeOptions()
        apply()
        document.querySelector('.email-list .email')?.focus()
    })
    clear.addEventListener('click', () => {
        input.value = ''
        apply()
        input.focus()
    })
    toggle.addEventListener('click', () => {
        if (!options.hidden) {
            closeOptions()
            return
        }
        void openOptions()
    })
    options.addEventListener('click', event => {
        if (!event.target.closest('.search-options-close')) { return }
        closeOptions()
        toggle.focus()
    })
    form.addEventListener('dmail:search-filter', event => { void openOptions(event.detail) })
    form.addEventListener('dmail:search-close', closeOptions)
    function applySearchOptions(event) {
        event.preventDefault()
        if (!optionsReady) { return }
        const fields = options.elements
        const error = options.querySelector('.search-options-error')
        try {
            const values = Object.fromEntries(
                ['query', 'from', 'to', 'subject', 'exclude', 'after', 'before', 'status'].map((field) => [field, fields[field].value]),
            )
            input.value = buildSearchQuery({ ...values, photo: fields.photo.checked })
        } catch (failure) {
            error.textContent = failure.message
            return
        }
        closeOptions()
        apply()
        input.focus()
        options.dispatchEvent(new Event('dmail:search-applied'))
    }

    options.addEventListener('submit', applySearchOptions)
    document.addEventListener('click', (event) => {
        if (!options.hidden && !options.contains(event.target) && !toggle.contains(event.target)) { closeOptions() }
    })
    function handleSearchKeys(event) {
        if (document.querySelector('.app').inert) { return }
        const blocked = document.querySelector('dialog[open], [popover]:popover-open, .settings-view:not([hidden]), .compose-layer:not([hidden])')
        if (!blocked && keyboardAction(event, getGeneralPreferences().shortcuts) === 'search') {
            event.preventDefault()
            input.focus()
        }
        if (event.key !== 'Escape') { return }
        if (!options.hidden) {
            event.preventDefault()
            closeOptions()
            toggle.focus()
        } else if (event.target === input && input.value) {
            event.preventDefault()
            input.value = ''
            apply()
        }
    }

    document.addEventListener('keydown', handleSearchKeys)
    function flush() {
        if (timer !== null) { apply() }
    }

    function reset(notify = true) {
        input.value = ''
        composing = false
        apply(notify)
        closeOptions()
    }

    return { flush, close: closeOptions, reset }
}
