export function swipeDirection(dx, dy, threshold = 72) {
    return Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.5 ? Math.sign(dx) : 0
}

export function initMobileTouch({ isMobile, select, back, closeDrawer }) {
    const list = document.querySelector('.email-list')
    const mail = document.querySelector('.mail')
    const drawer = document.querySelector('.sidebar')
    let gesture = null
    let hold = null
    let suppressClick = null
    let suppressionTimer = null

    // Consume the synthetic click after a long press or swipe so it cannot trigger a second action.
    function consumeClick(element) {
        suppressClick = element
        clearTimeout(suppressionTimer)
        suppressionTimer = setTimeout(() => {
            suppressClick = null
        }, 700)
    }

    function reset() {
        clearTimeout(hold)
        hold = null
        if (gesture?.row) {
            gesture.row.style.removeProperty('transform')
            gesture.row.classList.remove('touch-swiping')
        }
        gesture = null
    }

    function start(event) {
        suppressClick = null
        clearTimeout(suppressionTimer)
        reset()
        if (!isMobile() || event.pointerType === 'mouse' || !event.isPrimary) { return }
        if (event.target.closest('button, a, input, textarea, select, [contenteditable], .checkbox, .star')) { return }
        const row = event.target.closest('.email-list .email')
        const inDrawer = drawer.contains(event.target)
        const inMail = mail.contains(event.target) && event.clientX <= 32
        if (!row && !inDrawer && !inMail) { return }
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, row, inDrawer, inMail, held: false }
        if (row) { row.setPointerCapture(event.pointerId) }
        if (row) {
            hold = setTimeout(() => {
                if (!gesture || !row.isConnected) { return reset() }
                gesture.held = true
                consumeClick(row)
                select(row.dataset.id)
            }, 450)
        }
    }

    function move(event) {
        if (!gesture || event.pointerId !== gesture.id || gesture.held) { return }
        const dx = event.clientX - gesture.x
        const dy = event.clientY - gesture.y
        if (Math.hypot(dx, dy) > 10) {
            clearTimeout(hold)
            hold = null
        }
        if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) { return reset() }
        if (gesture.row && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            gesture.row.classList.add('touch-swiping')
            gesture.row.style.transform = `translateX(${Math.max(-96, Math.min(96, dx))}px)`
        }
    }

    function end(event) {
        if (!gesture || event.pointerId !== gesture.id) { return }
        const current = gesture
        const direction = swipeDirection(event.clientX - current.x, event.clientY - current.y)
        reset()
        if (current.held || !direction) { return }
        if (current.row) {
            consumeClick(current.row)
            select(current.row.dataset.id)
        } else if (current.inDrawer && direction < 0) {
            consumeClick(drawer)
            closeDrawer()
        } else if (current.inMail && direction > 0) {
            consumeClick(mail)
            back()
        }
    }

    document.addEventListener('pointerdown', start, { passive: true })
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerup', end, { passive: true })
    document.addEventListener('pointercancel', reset, { passive: true })
    list.addEventListener('scroll', reset, { passive: true })
    document.addEventListener('contextmenu', (event) => {
        if (isMobile() && event.target.closest('.email-list .email')) { event.preventDefault() }
    })
    document.addEventListener(
        'click',
        (event) => {
            if (!suppressClick?.contains(event.target)) { return }
            event.preventDefault()
            event.stopImmediatePropagation()
            suppressClick = null
        },
        true,
    )
    window.addEventListener('blur', reset)
}
