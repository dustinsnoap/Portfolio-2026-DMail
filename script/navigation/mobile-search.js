import { loadSearchHistory, rememberSearch, SEARCH_HISTORY_KEY } from '../search/search-history.js'
import { getGeneralPreferences } from '../settings/general-preferences.js'

export function initMobileSearch({ isMobile }) {
    const app = document.querySelector('.app')
    const form = document.querySelector('.searchbar')
    const input = form.querySelector('input')
    const options = document.querySelector('.search-options')
    const panel = document.createElement('section')
    panel.className = 'mobile-search-panel'
    panel.setAttribute('aria-label', 'Recent searches and filters')
    panel.hidden = true
    panel.innerHTML =
        `
        <div class="mobile-search-filters" aria-label="Search filters">
            <button type="button" data-filter="query">Labels ▾</button>
            <button type="button" data-filter="from">From ▾</button>
            <button type="button" data-filter="to">To ▾</button>
            <button type="button" data-filter="query" data-attachment>Attachment ▾</button>
            <button type="button" data-filter="after">Date ▾</button>
        </div>
        <h2>Recent mail searches</h2><div class="mobile-search-history"></div>
        <p class="mobile-search-tip">Search this view, or choose All mail in the menu to search` + ' across categories.</p>'
    app.append(panel)
    form.insertAdjacentHTML(
        'afterbegin',
        `
        <button type="button" class="mobile-search-back icon" aria-label="Back from search">
            <svg aria-hidden="true"><use href="/api/portfolio/assets/img/sprites.svg#icon-arrow" /></svg>
        </button>`,
    )
    input.setAttribute('enterkeyhint', 'search')

    function renderHistory() {
        const container = panel.querySelector('.mobile-search-history')
        container.replaceChildren()
        const enabled = getGeneralPreferences().rememberSearches
        const history = enabled ? loadSearchHistory() : []
        for (const query of history) {
            const button = document.createElement('button')
            button.type = 'button'
            button.textContent = query
            button.dataset.query = query
            container.append(button)
        }
        if (!history.length) { container.textContent = enabled ? 'Your recent searches will appear here.' : 'Recent searches are off.' }
    }

    function open() {
        if (!isMobile()) { return }
        app.classList.add('mobile-search-open')
        panel.hidden = false
        document.querySelector('.mailbox').inert = true
        renderHistory()
    }

    function close() {
        app.classList.remove('mobile-search-open')
        panel.hidden = true
        document.querySelector('.mailbox').inert = false
        options.hidden = true
        form.dispatchEvent(new Event('dmail:search-close'))
        form.querySelector('.settings').setAttribute('aria-expanded', 'false')
        if (document.activeElement === input) { input.blur() }
    }

    function remember() {
        if (getGeneralPreferences().rememberSearches) { rememberSearch(input.value) }
        if (isMobile()) { close() }
    }

    function filter(button) {
        const operator = button.hasAttribute('data-attachment') ? 'has:attachment' : button.dataset.filter === 'query' ? 'label:' : ''
        form.dispatchEvent(new CustomEvent('dmail:search-filter', { detail: { field: button.dataset.filter, operator } }))
    }

    function refreshHistory(event) {
        if (event.type === 'storage' && ![SEARCH_HISTORY_KEY, 'dmail_preferences_v1', null].includes(event.key)) { return }
        if (!panel.hidden) { renderHistory() }
    }

    document.addEventListener('dmail:general-change', refreshHistory)
    document.addEventListener('dmail:search-history-change', refreshHistory)
    window.addEventListener('storage', refreshHistory)
    input.addEventListener('focus', open)
    form.addEventListener('submit', remember)
    options.addEventListener('dmail:search-applied', remember)
    form.querySelector('.mobile-search-back').addEventListener('click', () => {
        close()
        document.querySelector('.menu-toggle').focus({ preventScroll: true })
    })
    panel.addEventListener('click', (event) => {
        const recent = event.target.closest('[data-query]')
        if (recent) {
            input.value = recent.dataset.query
            form.requestSubmit()
        }
        const chip = event.target.closest('[data-filter]')
        if (chip) {
            event.stopPropagation()
            filter(chip)
        }
    })
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && app.classList.contains('mobile-search-open') && options.hidden) {
            event.preventDefault()
            close()
        }
    })
    return { close }
}
