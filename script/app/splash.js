import { avatarPresentation } from '../account/account-avatar.js'
import { ACCOUNT_MARKER, AVATAR_KEY } from '../account/account-storage.js'
import { getMessagingSession } from '../storage/portfolio-api.js'

const PORTRAIT_HOLD = 1000
const MAX_WAIT = 1750

// Share the CSS timeout so a late script cannot prolong the splash.
function remainingWait(splash) {
    const fallback = splash.getAnimations().find(animation => animation.animationName === 'splash-timeout')
    return Math.max(0, MAX_WAIT - (fallback?.currentTime ?? 0))
}

function initSplash() {
    const splash = document.querySelector('.splash')
    if (!splash) { return }
    if (/^\/(signin|signup)\/?$/.test(location.pathname)) { splash.remove(); return }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const wait = remainingWait(splash)
    if (motion.matches || document.documentElement.dataset.motion === 'reduced' || document.hidden || wait < PORTRAIT_HOLD) {
        splash.remove()
        return
    }
    const startedAt = performance.now()
    let mailboxReady = Boolean(document.querySelector('.mailbox-controls'))
    let shownAt = null
    let revealTimer
    let deadline = setTimeout(reveal, wait)
    const inputEvents = ['pointerdown', 'keydown', 'wheel']

    function finish() {
        clearTimeout(deadline)
        clearTimeout(revealTimer)
        for (const type of inputEvents) { document.removeEventListener(type, finish, true) }
        document.removeEventListener('dmail:list-render', onMailboxReady)
        document.removeEventListener('visibilitychange', onVisibilityChanged)
        motion.removeEventListener('change', onMotionChanged)
        splash.removeEventListener('transitionend', onEffectFinished)
        splash.removeEventListener('animationend', onEffectFinished)
        splash.remove()
    }

    function reveal() {
        if (!splash.isConnected || splash.dataset.phase === 'revealing') { return }
        if (shownAt === null) { return finish() }
        clearTimeout(deadline)
        clearTimeout(revealTimer)
        splash.dataset.phase = 'revealing'
        deadline = setTimeout(finish, 280)
    }

    function scheduleReveal() {
        if (!mailboxReady || shownAt === null) { return }
        clearTimeout(revealTimer)
        revealTimer = setTimeout(reveal, Math.max(0, PORTRAIT_HOLD - (performance.now() - shownAt)))
    }

    function showPortrait() {
        if (!splash.isConnected) { return }
        if (performance.now() - startedAt > wait - PORTRAIT_HOLD) { return finish() }
        shownAt = performance.now()
        splash.dataset.phase = 'portrait'
        scheduleReveal()
    }

    function onMailboxReady() {
        mailboxReady = true
        scheduleReveal()
    }

    function onEffectFinished(event) {
        if (event.target !== splash) { return }
        if (event.propertyName === 'opacity' || event.animationName === 'splash-timeout') { finish() }
    }

    function onMotionChanged(event) {
        if (event.matches) { finish() }
    }

    function onVisibilityChanged() {
        if (document.hidden) { finish() }
    }

    function bindEvents() {
        for (const type of inputEvents) { document.addEventListener(type, finish, { capture: true, passive: true }) }
        document.addEventListener('dmail:list-render', onMailboxReady, { once: true })
        document.addEventListener('visibilitychange', onVisibilityChanged)
        motion.addEventListener('change', onMotionChanged)
        splash.addEventListener('transitionend', onEffectFinished)
        splash.addEventListener('animationend', onEffectFinished)
    }

    bindEvents()
    getMessagingSession().then(session => showAvatar(splash, session)).then(showPortrait).catch(finish)
}

async function showAvatar(splash, session) {
    if (!splash.isConnected) { return }
    let avatar = ''
    try {
        if (session.signedIn && localStorage.getItem(ACCOUNT_MARKER) === session.accountId) {
            avatar = localStorage.getItem(AVATAR_KEY) || ''
        }
    } catch { }
    const presentation = avatarPresentation(session, avatar)
    const container = splash.querySelector('.splash-photo')
    if (!presentation.image) { container.textContent = presentation.initial; return }
    const photo = document.createElement('img')
    photo.src = presentation.image
    photo.alt = ''
    container.replaceChildren(photo)
    await photo.decode()
}

function onShellParsed() {
    if (document.readyState === 'loading') { return }
    document.removeEventListener('readystatechange', onShellParsed)
    initSplash()
}

if (document.readyState === 'loading') { document.addEventListener('readystatechange', onShellParsed) } else { initSplash() }
