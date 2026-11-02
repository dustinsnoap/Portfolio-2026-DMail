import { escapeHtml } from '../messages/content.js'
import { OWNER_NAME } from './identity.js'

// The native popover may already be open when its lazy content arrives.
export function initAbout() {
    const panel = document.querySelector('#about-panel')
    let request
    let loaded = false

    async function load() {
        if (loaded || request) { return }
        const status = panel.querySelector('.about-status')
        const retry = panel.querySelector('[data-about-retry]')
        status.textContent = 'Loading About…'
        retry.hidden = true
        panel.setAttribute('aria-busy', 'true')
        try {
            request = import('./about-template.js')
            const { default: markup } = await request
            panel.innerHTML = markup.replaceAll('{{OWNER_NAME}}', () => escapeHtml(OWNER_NAME))
            loaded = true
            if (panel.matches(':popover-open')) { panel.querySelector('[autofocus]').focus() }
        } catch {
            status.textContent = 'About could not load. Please try again.'
            retry.hidden = false
        } finally {
            request = null
            panel.removeAttribute('aria-busy')
        }
    }

    panel.addEventListener('beforetoggle', event => {
        if (event.newState === 'open') { void load() }
    })
    panel.addEventListener('click', event => {
        if (event.target.closest('[data-about-retry]')) { void load() }
    })
    document.addEventListener('click', event => {
        const link = event.target.closest('a[data-about-link]')
        if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) { return }
        event.preventDefault()
        panel.showPopover({ source: link })
    })
    if (panel.matches(':popover-open')) { void load() }
}
