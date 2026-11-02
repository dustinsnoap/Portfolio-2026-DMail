import { spriteIcon as icon } from '../app/icons.js'
import { OWNER_FIRST_NAME } from '../app/identity.js'
import { CATEGORIES, getState, getVisiblePage } from '../mailbox/state.js'
import { escapeHtml } from '../messages/content.js'
import { isMailboxPath } from './conversation-links.js'
import { initMobileSearch } from './mobile-search.js'
import { initMobileTouch } from './mobile-touch.js'

export function initMobile({ back, clearSelection, select }) {
    const width = window.matchMedia('(width < 800px)')
    const app = document.querySelector('.app')
    const sidebar = document.querySelector('.sidebar')
    const menu = document.querySelector('.menu-toggle')
    const mailbox = document.querySelector('.mailbox')
    const list = document.querySelector('.email-list')
    const more = sidebar.querySelector('.toggle')
    const moreFolders = sidebar.querySelector('#more-folders')
    let desktopMoreHidden = moreFolders.hidden
    const backdrop = mountMobileControls(app, sidebar, mailbox)
    const heading = mailbox.querySelector('.mobile-heading')
    const toolbar = mailbox.querySelector('.top-bar')
    const selectionCount = mailbox.querySelector('.mobile-selection-count')
    const categoryLinks = [...sidebar.querySelectorAll('[data-mobile-category]')]
    const drawerClose = sidebar.querySelector('.mobile-drawer-close')
    const background = [...app.querySelectorAll('.topbar, .mailbox, .mobile-bottom-bar, .mobile-compose')]
    const search = initMobileSearch({ isMobile })
    let returnFocus = menu

    function toggleDrawer() {
        if (app.classList.contains('mobile-drawer-open')) { return closeDrawer() }
        returnFocus = document.activeElement
        app.classList.add('mobile-drawer-open')
        backdrop.hidden = false
        sidebar.inert = false
        sidebar.setAttribute('role', 'dialog')
        sidebar.setAttribute('aria-modal', 'true')
        menu.setAttribute('aria-expanded', 'true')
        setBackgroundInert(true)
        drawerClose.focus({ preventScroll: true })
    }

    function closeDrawer(restoreFocus = true) {
        const wasOpen = app.classList.contains('mobile-drawer-open')
        app.classList.remove('mobile-drawer-open')
        backdrop.hidden = true
        sidebar.inert = width.matches
        sidebar.removeAttribute('role')
        sidebar.removeAttribute('aria-modal')
        menu.setAttribute('aria-expanded', 'false')
        setBackgroundInert(false)
        if (wasOpen && restoreFocus) { returnFocus?.focus({ preventScroll: true }) }
    }

    function setBackgroundInert(value) {
        for (const region of background) { region.inert = value }
    }

    function refresh() {
        if (!width.matches) { return }
        refreshHeading()
        refreshCategories()
    }

    function refreshHeading() {
        const { activeCategory, activeLabel, search: query } = getState()
        const title = activeLabel || (activeCategory === 'all' ? 'All mail' : capitalize(activeCategory))
        heading.textContent = query.query ? 'Search results' : title
        toolbar.classList.toggle('mobile-paged', getVisiblePage().lastPage > 0)
    }

    function refreshCategories() {
        const { activeCategory } = getState()
        for (const category of categoryLinks) {
            const active = category.dataset.folder === activeCategory
            category.classList.toggle('active', active)
            category.setAttribute('aria-current', active ? 'page' : 'false')
        }
    }

    function refreshSelection() {
        if (!width.matches) { return }
        const { selected } = getState()
        app.classList.toggle('mobile-selecting', Boolean(selected.size))
        const text = `${selected.size} selected`
        if (selectionCount.textContent !== text) { selectionCount.textContent = text }
    }

    function drawerKeyboard(event) {
        if (!app.classList.contains('mobile-drawer-open')) { return }
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopImmediatePropagation()
            closeDrawer()
        }
        if (event.key !== 'Tab') { return }
        const buttons = [...sidebar.querySelectorAll('button')].filter((button) => button.getClientRects().length)
        const first = buttons[0]
        const last = buttons.at(-1)
        if ((event.shiftKey && event.target === first) || (!event.shiftKey && event.target === last)) {
            event.preventDefault()
            const next = event.shiftKey ? last : first
            next.focus()
        }
    }

    function resize() {
        closeDrawer(false)
        search.close()
        restoreFolderVisibility()
        if (width.matches) {
            refresh()
            refreshSelection()
            updateComposeSize()
        } else {
            app.classList.remove('mobile-selecting', 'mobile-list-scrolled')
        }
    }

    // Keep desktop More expansion independent from the folders exposed by the mobile drawer.
    function restoreFolderVisibility() {
        sidebar.inert = width.matches
        moreFolders.hidden = width.matches ? false : desktopMoreHidden
        more.setAttribute('aria-expanded', String(!moreFolders.hidden))
        more.querySelector('.title').textContent = moreFolders.hidden ? 'More' : 'Less'
    }

    function rememberFolderVisibility() {
        if (!width.matches) { desktopMoreHidden = moreFolders.hidden }
    }

    function updateComposeSize() {
        if (width.matches) { app.classList.toggle('mobile-list-scrolled', list.scrollTop > 32) }
    }

    function handleDrawerClick(event) {
        const navigation = '.mobile-drawer-close, .label-filter:not(.label-more-toggle), .label-clear, ' +
            '[data-add-label], [data-open-settings], [popovertarget]'
        if (event.target.closest(navigation)) { closeDrawer(false) }
    }

    function showMail() {
        search.close()
        back()
    }

    function handleAvatarError(event) {
        if (event.target.matches('.mobile-avatar img')) { event.target.hidden = true }
    }

    function bindShellEvents() {
        backdrop.addEventListener('click', () => closeDrawer())
        document.addEventListener('dmail:folder-toggle', rememberFolderVisibility)
        list.addEventListener('scroll', updateComposeSize, { passive: true })
        sidebar.addEventListener('click', handleDrawerClick)
        app.querySelector('.mobile-selection-close').addEventListener('click', clearSelection)
        app.querySelector('[data-mobile-mail]').addEventListener('click', showMail)
        document.addEventListener('keydown', drawerKeyboard, true)
        document.addEventListener('dmail:list-render', refresh)
        document.addEventListener('dmail:selection-change', refreshSelection)
        list.addEventListener('error', handleAvatarError, true)
        width.addEventListener('change', resize)
    }

    // Use the visual viewport to keep compose above the software keyboard without changing zoom.
    function resizeViewport() {
        const viewport = window.visualViewport
        if (!viewport || viewport.scale !== 1) { return }
        const style = document.documentElement.style
        for (const [name, value] of [
            ['height', viewport.height],
            ['top', viewport.offsetTop],
        ]) {
            const property = `--mobile-viewport-${name}`
            if (style.getPropertyValue(property) !== `${value}px`) { style.setProperty(property, `${value}px`) }
        }
    }
    function bindViewportEvents() {
        window.visualViewport?.addEventListener('resize', resizeViewport)
        window.visualViewport?.addEventListener('scroll', resizeViewport)
        resizeViewport()
    }

    bindShellEvents()
    bindViewportEvents()
    function isMobile() {
        return width.matches
    }

    initMobileTouch({ isMobile, select, back, closeDrawer })
    resize()
    return { isMobile, toggleDrawer, closeDrawer, closeSearch: search.close }
}

function buildDrawer() {
    const gear = document.querySelector('.portfolio-settings svg').outerHTML
    const icons = { primary: 'inbox-active', projects: 'projects-inactive', articles: 'articles-inactive', updates: 'updates-inactive' }
    const categories = CATEGORIES.map(
        (category) => `
        <button type="button" class="link" data-mobile-category data-folder="${category}">
            ${icon(icons[category])}
            <span>${capitalize(category)}</span>
        </button>`,
    ).join('')
    return (
        `<header class="mobile-drawer-header">
        <button type="button" class="mobile-home" data-home aria-label="DMail — return to Primary">Dmail</button>
        <button type="button" class="mobile-drawer-close" aria-label="Close navigation">×</button></header>
        <nav class="mobile-drawer-categories" aria-label="Inbox categories">${categories}</nav>
        <div class="mobile-drawer-tools"><button type="button" data-open-settings>${gear}<span>Settings</span></button>
        <button type="button" popovertarget="about-panel">
            ${icon('updates-inactive')}<span>About ${escapeHtml(OWNER_FIRST_NAME)}</span></button></div>`
    )
}

function buildBottomBar() {
    return `<button type="button" class="mobile-compose" data-compose-open>${icon('pencil')}<span>Compose</span></button>
        <nav class="mobile-bottom-bar" aria-label="Portfolio navigation">
            <button type="button" data-mobile-mail aria-label="Mail"><span>${icon('inbox-active')}</span><small>Mail</small></button>
            <button type="button" popovertarget="about-panel" aria-label="About ${escapeHtml(OWNER_FIRST_NAME)}">
                <span>${icon('info')}</span><small>About</small></button>
        </nav>`
}

function capitalize(value) {
    if (value === 'articles') { return 'Writing' }
    return value[0].toUpperCase() + value.slice(1)
}

function mountMobileControls(app, sidebar, mailbox) {
    const backdrop = document.createElement('button')
    backdrop.className = 'mobile-drawer-backdrop'
    backdrop.type = 'button'
    backdrop.setAttribute('aria-label', 'Close navigation')
    backdrop.hidden = true
    app.append(backdrop)
    sidebar.insertAdjacentHTML('afterbegin', buildDrawer())
    mailbox.insertAdjacentHTML('afterbegin', '<h2 class="mobile-heading">Primary</h2>')
    mailbox.querySelector('.top-bar').insertAdjacentHTML(
        'afterbegin',
        `
        <button type="button" class="mobile-selection-close" aria-label="Clear selection">${icon('arrow')}</button>
        <span class="mobile-selection-count" role="status"></span>`,
    )
    app.insertAdjacentHTML('beforeend', buildBottomBar())
    return backdrop
}

const STATE_KEY = '__dmailMobile'

// Each mobile overlay gets its own Back entry while preserving the underlying route.
export function initMobileHistory({ readLayers }) {
    const width = window.matchMedia('(width < 800px)')
    const saved = history.state?.[STATE_KEY]
    const valid = saved?.path === location.pathname && typeof saved.session === 'string' &&
        Number.isInteger(saved.depth) && saved.depth > 0 && saved.depth < 100
    const session = valid ? saved.session : (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
    const baseState = valid ? saved.base : history.state
    let depth = valid ? saved.depth : 0
    let stack = []
    let pending = false
    let targetDepth = 0
    let closing = false
    let requestedRoute = null

    function writeRoute() {
        if (!requestedRoute) { return }
        const request = requestedRoute
        requestedRoute = null
        const fields = history.state && typeof history.state === 'object' ? { ...history.state } : {}
        delete fields[STATE_KEY]
        history[request.replace ? 'replaceState' : 'pushState'](fields, '', request.hash)
    }

    function commitRoute(hash, replace = false) {
        requestedRoute = { hash, replace }
        if (pending) { return }
        if (depth) {
            pending = true
            targetDepth = 0
            history.go(-depth)
        } else { writeRoute() }
    }

    function entryDepth(state) {
        const entry = state?.[STATE_KEY]
        return entry?.session === session && entry.path === location.pathname ? entry.depth : 0
    }

    function pushEntry() {
        depth++
        const fields = baseState && typeof baseState === 'object' ? baseState : {}
        history.pushState({ ...fields, [STATE_KEY]: { session, path: location.pathname, depth, base: baseState } }, '')
    }

    function synchronize() {
        if (closing) { return }
        if (!isMailboxPath(location.pathname)) {
            stack = []
            depth = 0
            pending = false
            requestedRoute = null
            return
        }
        const active = width.matches ? readLayers() : []
        const keys = new Set(active.map(layer => layer.key))
        const retained = stack.filter(layer => keys.has(layer.key))
        const existing = new Set(retained.map(layer => layer.key))
        stack = [...retained, ...active.filter(layer => !existing.has(layer.key))]
        if (pending) { return }
        if (stack.length < depth) {
            pending = true
            targetDepth = stack.length
            history.go(stack.length - depth)
        } else {
            while (depth < stack.length) { pushEntry() }
        }
    }

    function navigate(event) {
        if (!isMailboxPath(location.pathname)) { return }
        const nextDepth = entryDepth(event.state)
        if (nextDepth < (pending ? targetDepth : depth)) {
            const removed = stack.slice(nextDepth).reverse()
            stack = stack.slice(0, nextDepth)
            closing = true
            try {
                for (const layer of removed) { layer.close() }
            } finally {
                closing = false
            }
        }
        depth = nextDepth
        pending = false
        writeRoute()
        // Forward into a closed overlay must not leave a stale Back stop in front of the mailbox.
        synchronize()
    }

    // Typing must not create Back entries; observe only overlay visibility and mounted layers.
    const layerSelector = '.app, .reply-form, .compose-layer, .search-options, .more-menu, .options, .editor-panel, dialog, [popover]'
    function observe(records) {
        if (!width.matches && !depth) { return }
        const relevant = records.some(record => record.type === 'attributes' ? record.target.matches(layerSelector)
            : [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
                && (node.matches(layerSelector) || node.querySelector(layerSelector))))
        if (relevant) { synchronize() }
    }

    const observer = new MutationObserver(observe)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['class', 'hidden', 'open', 'inert'],
    })
    window.addEventListener('popstate', navigate)
    window.addEventListener('pageshow', synchronize)
    document.addEventListener('toggle', synchronize, true)
    width.addEventListener('change', synchronize)
    // Retire pre-reload overlay entries because their UI no longer exists.
    if (valid) {
        pending = true
        targetDepth = 0
        history.go(-depth)
    } else { synchronize() }
    return { commitRoute, routePending: () => requestedRoute !== null }
}

export function mobileLayers({ pane, mobile, settings, compose, replies, search, menus, clearSelection, isSelected }) {
    const app = document.querySelector('.app')
    const layers = []

    function add(key, open, close) {
        if (open) { layers.push({ key, close }) }
    }

    add('thread', pane.isOpen(), pane.close)
    add('selection', isSelected(), clearSelection)
    add('settings', app.classList.contains('settings-open'), settings.close)
    add('search', app.classList.contains('mobile-search-open'), mobile.closeSearch)
    add('drawer', app.classList.contains('mobile-drawer-open'), mobile.closeDrawer)
    const composing = document.querySelector('.compose-layer:not([hidden])')
    add('compose', composing, () => {
        if (composing.querySelector('[aria-busy="true"]')) { return }
        compose.close()
    })
    add('reply', pane.isOpen() && document.querySelector('.reply-form'), replies.closeReply)
    add('search-options', !document.querySelector('.search-options').hidden, search.close)
    const menu = document.querySelector('.more-menu:not(.hidden), .mail .message > .options:not(.hidden)')
    add('menu', menu && !menu.closest('[hidden]'), menus.close)
    for (const panel of document.querySelectorAll('.editor-panel:not([hidden])')) {
        if (!panel.closest('[hidden]')) { add(panel, true, () => panel.querySelector('[data-action="close-panel"]').click()) }
    }
    for (const popover of document.querySelectorAll('[popover]:popover-open')) {
        if (popover !== menu) { add(popover, true, () => popover.hidePopover()) }
    }
    for (const dialog of document.querySelectorAll('dialog[open]')) { add(dialog, true, () => dialog.close()) }
    return layers
}
