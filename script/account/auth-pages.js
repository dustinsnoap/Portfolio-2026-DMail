import { OWNER_FIRST_NAME } from '../app/identity.js'
import { escapeHtml } from '../messages/content.js'
import { isMailboxPath } from '../navigation/conversation-links.js'
import { startMessageSync, stopMessageSync } from '../storage/persistence.js'
import { accountRequest, normalizeEmail, optionalBirthday, signupProfile, validatePassword } from './auth-client.js'

const SIGNUP_STEPS = ['name', 'details', 'email', 'password', 'verify']

// Passwords and MFA challenges stay in memory and are cleared when this screen closes.
export function initAuthPages({ settings, onAuthenticated }) {
    const app = document.querySelector('.app')
    const screen = document.createElement('section')
    screen.className = 'auth-shell'
    screen.hidden = true
    document.body.append(screen)
    let step = ''
    let state = {}
    let busy = false
    let challenge = null
    let previousFocus = null
    let resendAt = 0
    let signupMode = false
    let verifiedEmail = ''
    let returnHash = ''
    const portfolioTitle = document.title

    function show(next, notice = '') {
        step = next
        screen.innerHTML = authMarkup(step, state, notice)
        document.title = `${screen.querySelector('#auth-title').textContent} · Dmail`
        screen.querySelector('input')?.focus({ preventScroll: true })
    }

    function open(signup = false, push = true) {
        if (isMailboxPath(location.pathname)) { returnHash = location.pathname + location.search + location.hash }
        signupMode = signup
        verifiedEmail = ''
        previousFocus = document.activeElement
        for (const panel of document.querySelectorAll('[popover]:popover-open')) { panel.hidePopover() }
        state = { firstName: '', lastName: '', birthdate: '', gender: '', phone: '', email: '', password: '', confirmation: '' }
        challenge = null
        screen.hidden = false
        app.hidden = app.inert = true
        if (push) { history.pushState(null, '', signup ? '/signup/' : '/signin/') }
        show(signup ? 'name' : 'signin')
    }

    function close(push = true) {
        if (busy) { return }
        if (screen.hidden) { return }
        state = {}
        challenge = null
        verifiedEmail = ''
        step = ''
        screen.replaceChildren()
        screen.hidden = true
        app.hidden = app.inert = false
        if (push) { history.pushState(null, '', returnHash || '/') }
        returnHash = ''
        document.title = portfolioTitle
        document.dispatchEvent(new Event('dmail:auth-close'))
        const target = previousFocus?.matches('button, a, input') && previousFocus.getClientRects().length
            ? previousFocus : document.querySelector('.profile')
        target?.focus({ preventScroll: true })
    }

    function request(operation, input) {
        return accountRequest(settings(), operation, input)
    }

    async function finish(result) {
        if (!result.signedIn) {
            if (['authenticator', 'sms', 'email', 'password'].includes(result.challenge)) {
                challenge = result
                state.verificationMethod = result.challenge
                state.password = state.confirmation = ''
                show(result.challenge === 'password' ? 'challenge' : 'mfa')
                return
            }
            throw new Error(`This account requires an unsupported verification method. Contact ${OWNER_FIRST_NAME} for help.`)
        }
        state.password = state.confirmation = ''
        await onAuthenticated()
        busy = false
        close()
        location.reload()
    }

    async function authenticate() {
        stopMessageSync()
        try {
            await finish(await request('signin', { email: state.email, password: state.password }))
        } catch (error) {
            if (error.code === 'unconfirmed') {
                show('verify', 'Use the code in your confirmation email, or request a new code.')
            } else if (error.code === 'password-reset') {
                state.password = ''
                show('forgot')
            } else { throw error }
        } finally { startMessageSync() }
    }

    async function register(values) {
        validatePassword(values.password, values.confirmation)
        state.password = values.password
        state.confirmation = ''
        const result = await request('signup', { ...signupProfile(state), password: state.password })
        resendAt = Date.now()
        if (result.confirmed) { await authenticate() } else { show('verify') }
    }

    async function verify(values) {
        if (verifiedEmail !== state.email) { await request('confirm', { email: state.email, code: values.code }) }
        verifiedEmail = state.email
        if (state.password) { await authenticate() } else { show('welcome', 'Email verified. Enter your password to sign in.') }
    }

    async function answerChallenge(values) {
        const input = { continuation: challenge.continuation }
        if (challenge.challenge === 'password') {
            validatePassword(values.password, values.confirmation)
            input.password = values.password
        } else { input.code = values.code }
        stopMessageSync()
        try { await finish(await request('challenge', input)) } finally { startMessageSync() }
    }

    async function advance(values) {
        if (step === 'name') {
            state.firstName = values.firstName.trim()
            state.lastName = values.lastName.trim()
            if (!state.firstName || `${state.firstName} ${state.lastName}`.trim().length > 100) { throw new Error('Enter your name.') }
            return show('details')
        }
        if (step === 'details') {
            state.birthdate = optionalBirthday(values.month, values.day, values.year)
            state.gender = values.gender
            state.phone = values.phone
            signupProfile({ ...state, email: 'validation@example.com' })
            return show('email')
        }
        if (['email', 'signin'].includes(step)) {
            state.email = normalizeEmail(values.email)
            return show(step === 'email' ? 'password' : 'welcome')
        }
        if (step === 'password') { return register(values) }
        if (step === 'verify') { return verify(values) }
        if (step === 'welcome') { state.password = values.password; return authenticate() }
        if (['mfa', 'challenge'].includes(step)) { return answerChallenge(values) }
        if (step === 'forgot') {
            state.email = normalizeEmail(values.email)
            await request('recover', { email: state.email })
            resendAt = Date.now()
            return show('reset', 'If an account exists for this email, you will receive a reset code.')
        }
        validatePassword(values.password, values.confirmation)
        await request('reset', { email: state.email, code: values.code, password: values.password })
        state.password = state.confirmation = ''
        show('welcome', 'Password updated. Sign in with your new password.')
    }

    async function submit(event) {
        event.preventDefault()
        if (busy) { return }
        const form = event.target
        if (!form.reportValidity()) { return }
        const values = Object.fromEntries(new FormData(form))
        busy = true
        form.setAttribute('aria-busy', 'true')
        const label = form.querySelector('.auth-next').textContent
        form.querySelector('.auth-next').textContent = 'Please wait…'
        for (const button of form.querySelectorAll('button')) { button.disabled = true }
        try { await advance(values) } catch (error) {
            screen.querySelector('.auth-error').textContent = error.message
            for (const input of screen.querySelectorAll('input:not([type="checkbox"])')) { input.setAttribute('aria-describedby', 'auth-error') }
        } finally {
            busy = false
            if (form.isConnected) { form.querySelector('.auth-next').textContent = label }
            screen.querySelector('form')?.removeAttribute('aria-busy')
            for (const button of screen.querySelectorAll('button')) { button.disabled = false }
        }
    }

    async function resend() {
        if (Date.now() - resendAt < 30000) { throw new Error('Please wait 30 seconds before requesting another code.') }
        busy = true
        try {
            await request(step === 'reset' ? 'recover' : 'resend', { email: state.email })
            resendAt = Date.now()
            screen.querySelector('.auth-notice').textContent = 'A new code has been requested. Check your email.'
        } finally { busy = false }
    }

    function navigate(action) {
        if (action === 'close') { return close() }
        if (action === 'signup') { return open(true) }
        if (action === 'skip') {
            state.birthdate = state.gender = state.phone = ''
            return show('email')
        }
        if (action === 'forgot') { state.password = ''; return show('forgot') }
        if (action === 'use-another') {
            state.password = state.confirmation = ''
            challenge = null
            verifiedEmail = ''
            return show(signupMode ? 'email' : 'signin')
        }
        state.password = state.confirmation = ''
        if (step === 'name' || step === 'signin') { return close() }
        if (step === 'verify' && !signupMode) { return show('welcome') }
        show(SIGNUP_STEPS.includes(step) ? SIGNUP_STEPS[Math.max(0, SIGNUP_STEPS.indexOf(step) - 1)] : 'signin')
    }

    function change(event) {
        if (!event.target.matches('[data-show-password]')) { return }
        for (const input of screen.querySelectorAll('[name="password"], [name="confirmation"]')) {
            input.type = event.target.checked ? 'text' : 'password'
        }
    }

    async function click(event) {
        const action = event.target.closest('[data-auth-action]')?.dataset.authAction
        if (!action || busy) { return }
        screen.querySelector('.auth-error').textContent = ''
        try {
            if (action === 'resend') {
                await resend()
            } else if (action === 'help') {
                document.querySelector('#auth-help-panel').showPopover()
            } else { navigate(action) }
        } catch (error) { screen.querySelector('.auth-error').textContent = error.message }
    }

    function route() {
        if (/^\/(signin|signup)\/?$/.test(location.pathname)) { open(location.pathname.startsWith('/signup'), false) } else { close(false) }
    }

    screen.addEventListener('submit', submit)
    screen.addEventListener('change', change)
    screen.addEventListener('click', click)
    window.addEventListener('popstate', route)
    route()
    return { open, close }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DESCRIPTIONS = {
    name: ['Create a Dmail account', 'Enter your name'],
    details: ['Basic information', 'These details are optional. You can skip this step.'],
    email: ['Use your email address', 'Use an existing email address to sign in to Dmail'],
    password: ['Create a strong password', 'Use at least 12 characters with a mix of letters, numbers, and symbols'],
    verify: ['Check your email', 'Enter the verification code we sent to your email'],
    signin: ['Sign in', 'Use your Dmail account'],
    welcome: ['Welcome', 'Enter your password to continue'],
    mfa: ['Verify it’s you', 'Enter the code from your authenticator app'],
    forgot: ['Recover your account', 'Enter your email address to reset your password'],
    reset: ['Reset your password', 'Enter your email code and choose a new password'],
    challenge: ['Choose a new password', 'Update your temporary password to continue'],
}

function field(name, label, value = '', { type = 'text', autocomplete = '', required = false, extra = '' } = {}) {
    return `<label class="auth-field"><input name="${name}" type="${type}" value="${escapeHtml(value)}" placeholder=" "
        autocomplete="${autocomplete}"${required ? ' required' : ''} ${extra}><span>${label}</span></label>`
}

function details(profile) {
    const [year = '', month = '', day = ''] = (profile.birthdate || '').split('-')
    return `<fieldset class="auth-birthday"><legend>Birthday (optional)</legend><div>
        <label class="auth-select"><span class="visually-hidden">Month</span><select name="month" autocomplete="bday-month">
        <option value="">Month</option>${MONTHS.map((name, index) => `<option value="${index + 1}"${Number(month) === index + 1
            ? ' selected' : ''}>${name}</option>`).join('')}</select></label>
        ${field('day', 'Day', day, { extra: 'inputmode="numeric" maxlength="2"', autocomplete: 'bday-day' })}
        ${field('year', 'Year', year, { extra: 'inputmode="numeric" maxlength="4"', autocomplete: 'bday-year' })}</div></fieldset>
        <label class="auth-select"><span class="visually-hidden">Gender (optional)</span><select name="gender" autocomplete="sex">
        <option value="">Gender (optional)</option>${['Female', 'Male', 'Nonbinary', 'Prefer not to say'].map(value =>
            `<option${profile.gender === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        ${field('phone', 'Phone number (optional)', profile.phone, { type: 'tel', autocomplete: 'tel', extra: 'maxlength="32"' })}
        <p class="auth-note">Only your name and email are required. Optional details stay with your account.</p>`
}

function passwords(state, current = false) {
    return field('password', current ? 'Enter your password' : 'Password', state.password,
        { type: 'password', required: true, autocomplete: current ? 'current-password' : 'new-password', extra: 'maxlength="256"' })
        + (current ? '' : field('confirmation', 'Confirm', state.confirmation,
            { type: 'password', required: true, autocomplete: 'new-password', extra: 'maxlength="256"' }))
        + '<label class="auth-show"><input type="checkbox" data-show-password>Show password</label>'
}

function controls(step, state) {
    if (step === 'name') {
        return field('firstName', 'First name', state.firstName,
            { required: true, autocomplete: 'given-name', extra: 'maxlength="50"' })
            + field('lastName', 'Last name (optional)', state.lastName, { autocomplete: 'family-name', extra: 'maxlength="50"' })
    }
    if (step === 'details') { return details(state) }
    if (['email', 'signin', 'forgot'].includes(step)) {
        return field('email', 'Email', state.email,
            { type: 'email', required: true, autocomplete: 'username', extra: 'maxlength="254" spellcheck="false"' })
    }
    if (['password', 'welcome', 'challenge'].includes(step)) { return passwords(state, step === 'welcome') }
    const code = field('code', step === 'mfa' ? 'Authenticator code' : 'Verification code', '',
        { required: true, autocomplete: 'one-time-code', extra: 'inputmode="numeric" maxlength="6" pattern="[0-9]{6}"' })
    return code + (step === 'reset' ? passwords({}) : '')
}

export function authMarkup(step, state, notice = '') {
    const [title, defaultDescription] = DESCRIPTIONS[step]
    const description = step === 'mfa' && state.verificationMethod !== 'authenticator'
        ? state.verificationMethod === 'sms' ? 'Enter the verification code sent to your phone' : 'Enter the code sent to your email'
        : defaultDescription
    const chip = ['welcome', 'mfa', 'verify', 'reset', 'challenge'].includes(step)
    return `<div class="auth-wrap"><main class="auth-card" aria-labelledby="auth-title">
        <section class="auth-intro">
                <svg class="auth-logo" aria-label="Dmail" role="img">
                    <use href="/api/portfolio/assets/img/sprites.svg#dmail-logo"/></svg>
        <h1 id="auth-title">${title}</h1>${chip ? `<button type="button" class="auth-account-chip" data-auth-action="use-another">
        <span aria-hidden="true">◉</span>${escapeHtml(state.email)}<span aria-hidden="true">⌄</span></button>`
        : `<p>${description}</p>`}</section>
        <form class="auth-form" novalidate>${chip ? `<p class="auth-description">${description}</p>` : ''}${controls(step, state)}
        ${['verify', 'reset'].includes(step) ? '<button type="button" class="auth-link" data-auth-action="resend">Resend code</button>' : ''}
        <p class="auth-error" role="alert" id="auth-error"></p><p class="auth-notice" role="status">${escapeHtml(notice)}</p>
        <div class="auth-actions">${step === 'signin' ? '<button type="button" class="auth-link" data-auth-action="signup">Create account</button>'
            : step === 'welcome' ? '<button type="button" class="auth-link" data-auth-action="forgot">Forgot password?</button>'
            : step === 'details' ? '<button type="button" class="auth-link" data-auth-action="skip">Skip</button>'
            : '<button type="button" class="auth-link" data-auth-action="back">Back</button>'}
        <button class="auth-next" type="submit">${step === 'verify' ? 'Verify' : step === 'reset' ? 'Save password' : 'Next'}</button></div>
        </form></main><footer class="auth-footer"><button type="button" data-auth-action="close">Back to portfolio</button>
        <nav aria-label="Account information"><button type="button" data-auth-action="help">Help</button>
        <button type="button" popovertarget="privacy-panel">Privacy</button><button type="button" popovertarget="terms-panel">Terms</button>
        </nav></footer></div>`
}
