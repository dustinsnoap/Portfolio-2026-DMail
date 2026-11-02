import { spriteIcon } from '../app/icons.js'
import { OWNER_FIRST_NAME } from '../app/identity.js'
import { escapeHtml } from '../messages/content.js'
import { startMessageSync, stopMessageSync } from '../storage/persistence.js'
import { apiJSON, getMessagingSession } from '../storage/portfolio-api.js'
import { prepareAvatar, renderAvatar, saveAvatar } from './account-avatar.js'
import { clearAccountCache } from './account-storage.js'
import { flushAccount, restoreAccount, startAccountSync, stopAccountSync } from './account-sync.js'
import { initPolicyPanels } from './policy-panels.js'

let session = { signedIn: false }
let status = 'Your settings are saved in this browser.'
let authRequest
let reauthenticationRequired = false

async function ensureAuthPages() {
    authRequest ??= import('./auth-pages.js')
        .then(({ initAuthPages }) => initAuthPages({ settings: () => session.signIn, onAuthenticated: finishAuthentication }))
        .catch(error => { authRequest = null; throw error })
    return authRequest
}

function panel(id, title, body) {
    const element = document.createElement('section')
    element.id = id
    element.className = 'about-panel account-panel'
    element.setAttribute('popover', 'auto')
    element.setAttribute('role', 'dialog')
    element.setAttribute('aria-labelledby', `${id}-title`)
    element.innerHTML = `<header class="about-header"><h2 id="${id}-title">${title}</h2>
        <button type="button" popovertarget="${id}" popovertargetaction="hide" aria-label="Close ${title}" autofocus>×</button>
        </header>${body}`
    document.body.append(element)
    return element
}

function renderAccount() {
    const name = session.signedIn ? session.name || 'Your account' : 'Guest'
    document.querySelector('[data-account-name]').textContent = session.signedIn
        ? session.name ? `Hi, ${name}!` : 'Welcome back' : 'Welcome to Dmail'
    document.querySelector('[data-account-detail]').textContent = session.signedIn
        ? 'Your settings and conversations follow your account.' : 'Demo messages stay in this browser. Accounts are available on the live site.'
    document.querySelector('[data-open-signin]').hidden = session.signedIn && !reauthenticationRequired
    document.querySelector('[data-signout]').hidden = !session.signedIn
    document.querySelector('[data-change-avatar]').hidden = !session.signedIn
    document.querySelector('[data-forward-permissions]').hidden = !session.signedIn
    document.querySelector('.account-actions').classList.toggle('guest', !session.signedIn)
    document.querySelector('[data-account-status]').textContent = status
    document.querySelector('.profile').setAttribute('aria-label', `Account options: ${name}`)
    renderAvatar(session)
}

// Session lookup failures must not block public browsing.
export async function initAccount() {
    initPolicyPanels()
    const { account, avatar } = mountAccountPanels()
    bindAccountActions(account, avatar)
    renderAccount()
    if (/^\/(signin|signup)\/?$/.test(location.pathname)) { await ensureAuthPages() }
    await restoreSession()
    renderAccount()
    return Boolean(session.signedIn)
}

function mountAccountPanels() {
    const account = panel('account-panel', 'Dmail account', accountMarkup())
    const avatar = panel('avatar-panel', 'Change avatar', avatarMarkup())
    panel('auth-help-panel', 'Account help', accountHelpMarkup())
    return { account, avatar }
}

async function restoreSession() {
    try {
        session = await getMessagingSession()
        await restoreAccount(session)
        status = session.signedIn ? 'Saved to your account' : 'Your settings are saved in this browser.'
        startAccountSync()
    } catch (error) { status = error.message }
}

function bindAccountActions(account, avatar) {
    avatar.addEventListener('beforetoggle', event => {
        if (event.newState === 'open' && !session.signedIn) { event.preventDefault() }
    })
    account.addEventListener('beforetoggle', event => {
        if (event.newState === 'open') { renderAccount() }
    })
    document.addEventListener('dmail:account-status', event => {
        status = event.detail
        document.querySelector('[data-account-status]').textContent = status
    })
    document.addEventListener('dmail:session-expired', () => {
        reauthenticationRequired = true
        stopMessageSync()
        renderAccount()
    })
    document.querySelector('[data-open-signin]').onclick = async () => {
        if (!session.signIn?.enabled) { status = 'Accounts are available on the live portfolio at dustinsnoap.com.'; renderAccount(); return }
        await flushAccount().catch(error => { status = error.message })
        try { (await ensureAuthPages()).open() } catch (error) { status = error.message; renderAccount() }
    }
    document.querySelector('[data-signout]').onclick = signOut
    avatar.querySelector('[data-avatar-file]').onchange = async event => {
        const file = event.target.files[0]
        if (!file) { return }
        try {
            if (!session.signedIn) { throw new Error('Sign in to change your avatar.') }
            saveAvatar(await prepareAvatar(file), session)
            await flushAccount()
            avatar.hidePopover()
        } catch (error) { avatar.querySelector('[data-avatar-status]').textContent = error.message }
        event.target.value = ''
    }
    avatar.querySelector('[data-avatar-reset]').onclick = async () => {
        try { saveAvatar('', session); await flushAccount(); avatar.hidePopover() } catch (error) {
            avatar.querySelector('[data-avatar-status]').textContent = error.message
        }
    }
}

// Keep unsent work on sign-out, even when its network save fails.
async function signOut(event) {
    const button = event.currentTarget
    button.disabled = true
    try {
        stopMessageSync()
        await flushAccount().catch(error => { status = error.message })
        await apiJSON('/session/signout', {})
        stopAccountSync()
        clearAccountCache()
        location.assign('/')
    } catch (error) {
        if (!reauthenticationRequired) { startMessageSync() }
        status = error.message
        renderAccount()
        button.disabled = false
    }
}

async function finishAuthentication() {
    session = await getMessagingSession(true)
    await restoreAccount(session)
    reauthenticationRequired = false
    status = 'Saved to your account'
    renderAccount()
}

export function accountMarkup() {
    return `<div class="account-identity">
        <span class="account-avatar" data-account-avatar aria-hidden="true"></span>
        <h3 data-account-name></h3><p data-account-detail></p></div>
        <div class="account-actions"><button type="button" data-open-signin>Sign in</button>
        <button type="button" data-change-avatar popovertarget="avatar-panel" hidden>Change avatar</button>
        <button type="button" data-signout hidden>Sign out</button></div>
        <p class="account-status" data-account-status role="status" aria-live="polite"></p>
        <button type="button" class="account-forwarding" data-forward-permissions hidden>Forwarding permissions</button>
        <section class="account-owner" aria-labelledby="account-owner-title"><h3 id="account-owner-title">Contact ${escapeHtml(OWNER_FIRST_NAME)}</h3>
        <div class="account-links">
            <a href="https://dustinsnoap.com/">${spriteIcon('all-mail')}
                <span>Visit the live portfolio<small>dustinsnoap.com</small></span></a>
            <a href="https://linkedin.com/in/dustinsnoap" target="_blank" rel="noopener noreferrer">
                <span class="account-link-icon" aria-hidden="true">in</span><span>LinkedIn profile</span></a>
            <a href="https://github.com/dustinsnoap/Portfolio-2026-DMail" target="_blank" rel="noopener noreferrer">
                ${spriteIcon('github')}<span>View on GitHub</span></a>
            <a href="/api/portfolio/assets/resume/index.html">${spriteIcon('articles-inactive')}<span>View resume</span></a>
        </div></section>
        <footer class="account-legal"><button type="button" popovertarget="privacy-panel">Demo privacy</button><span>·</span>
        <button type="button" popovertarget="terms-panel">About this demo</button></footer>`
}

export function avatarMarkup() {
    return `<span class="account-avatar" data-account-avatar aria-hidden="true"></span>
        <p>Choose a photo for your profile. It will be cropped to a square.</p><label class="avatar-upload">Choose a photo
        <input type="file" accept="image/png,image/jpeg,image/webp" data-avatar-file></label>
        <button type="button" data-avatar-reset>Use my initial</button><p class="account-status" data-avatar-status role="status"></p>`
}

export function accountHelpMarkup() {
    return `<p>Create an account using your name and an existing email address.
        Birthday, gender, and phone number are optional. Verify your email using the code we send you.</p>
        <p>Use Forgot password on the password step to recover your account. An account with two-step verification
        also asks for its verification code. Signing in restores your saved settings and conversations.</p>`
}
