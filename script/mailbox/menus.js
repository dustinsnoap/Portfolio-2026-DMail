export function initMenus() {
    let openMenu = null
    let menuTrigger = null
    function closeMenu() {
        if (!openMenu) { return }
        openMenu.classList.add('hidden')
        openMenu.inert = true
        if (openMenu.hasAttribute('popover')) { openMenu.hidePopover() }
        menuTrigger.setAttribute('aria-expanded', 'false')
        openMenu = null
        menuTrigger = null
    }

    function toggleMenu(menu, trigger) {
        const wasOpen = openMenu === menu
        closeMenu()
        if (wasOpen) { return }
        menu.classList.remove('hidden')
        menu.inert = false
        trigger.setAttribute('aria-expanded', 'true')
        openMenu = menu
        menuTrigger = trigger
        if (menu.hasAttribute('popover')) {
            menu.showPopover()
            positionMenu()
        }
        menu.querySelector('button')?.focus({ preventScroll: true })
    }

    function positionMenu() {
        if (!openMenu) { return }
        if (!openMenu.hasAttribute('popover')) { return closeMenu() }
        // Native popovers escape thread clipping, so anchor them in viewport coordinates.
        const anchor = menuTrigger.getBoundingClientRect()
        const thread = menuTrigger.closest('.thread').getBoundingClientRect()
        if (anchor.bottom <= Math.max(8, thread.top) || anchor.top >= Math.min(window.innerHeight - 8, thread.bottom)) { return closeMenu() }
        const width = openMenu.offsetWidth
        const height = openMenu.offsetHeight
        const below = anchor.bottom + 2
        const top = below + height <= window.innerHeight - 8 ? below : anchor.top - height - 2
        openMenu.style.left = `${Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))}px`
        openMenu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`
    }

    function repositionMenu(event) {
        if (openMenu && event.target !== openMenu) { positionMenu() }
    }

    function closeOutside(target) {
        if (openMenu && !openMenu.contains(target) && !menuTrigger.contains(target)) { closeMenu() }
    }

    function dismiss(event) {
        if (openMenu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && openMenu.contains(event.target)) {
            const buttons = [...openMenu.querySelectorAll('button')].filter(button => button.getClientRects().length)
            const index = buttons.indexOf(document.activeElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
            event.preventDefault()
            buttons[next]?.focus()
            return
        }
        if (event.defaultPrevented || event.key !== 'Escape' || !openMenu) { return }
        event.preventDefault()
        const trigger = menuTrigger
        closeMenu()
        trigger.focus()
    }

    document.querySelectorAll('.more-menu, .top-bar .options.selected').forEach((region) => {
        region.inert = true
    })
    document.addEventListener('scroll', repositionMenu, true)
    window.addEventListener('resize', positionMenu)
    return { close: closeMenu, toggle: toggleMenu, closeOutside, dismiss }
}
