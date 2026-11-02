import { initAccount } from './account/account.js'
import { ACCOUNT_CACHE_NOTICE, accountCacheAvailable, prepareAccountCache } from './account/account-storage.js'
import { initAbout } from './app/about.js'
import { initActivity } from './app/activity.js'
import { initHandlers } from './app/handlers.js'
import { createDelivery } from './mailbox/delivery.js'
import { restoreLabels } from './mailbox/label-ui.js'
import { loadFolderChoices } from './mailbox/mailbox-folders.js'
import { restoreReadStatus, restoreStars } from './mailbox/mailbox-status.js'
import { renderEmailList, updateOpenThread } from './mailbox/render.js'
import { renderSidebarCounts } from './mailbox/sidebar-counts.js'
import {
    addMessage, addPortfolioEmail, getState, init, setActiveCategory, setActiveFolder, setActiveLabel, setSearchQuery,
} from './mailbox/state.js'
import { initChatbotMailbox } from './messages/chatbot-mailbox.js'
import { initForwardConsent } from './messages/forward-consent.js'
import { initMessageSync } from './messages/message-sync.js'
import { initTimestampClock } from './messages/timestamps.js'
import { initResetLifecycle } from './settings/browser-reset.js'
import { getGeneralPreferences, initGeneralPreferences } from './settings/general-preferences.js'
import { loadMessages, loadReplies, stopMessageSync } from './storage/persistence.js'
import { getMessagingSession } from './storage/portfolio-api.js'
import { flushRemoteMailbox, pollRemoteMailbox, queueLocalReplies } from './storage/remote-mailbox.js'

const RETIRED_SAMPLE_THREADS = new Set(['th-101', 'th-001', 'th-003', 'th-004', 'th-005'])

async function restoreMessages() {
    let notice = ''
    try {
        const messages = await loadMessages()
        for (const message of messages) {
            try { addMessage(message) } catch (error) {
                notice = 'Some saved messages could not be loaded. Their browser copies have been retained.'
                console.warn('Unable to restore saved message', error)
            }
        }
    } catch (error) {
        notice = 'Saved messages could not be loaded. Their browser copies have been retained.'
        console.warn('Unable to read saved messages', error)
    }
    try {
        const replies = await loadReplies()
        queueLocalReplies(replies.filter(reply => !RETIRED_SAMPLE_THREADS.has(reply?.threadId)))
        flushRemoteMailbox()
    } catch (error) {
        notice = 'Some saved replies could not be loaded. Their browser copies have been retained.'
        console.warn('Unable to restore saved replies', error)
    }
    return notice
}

function restorePreferences(notice) {
    if (!accountCacheAvailable) { return ACCOUNT_CACHE_NOTICE }
    try {
        restoreLabels()
        restoreStars()
        restoreReadStatus()
        return notice
    } catch {
        return 'Saved labels, stars, or read status could not be loaded.'
    }
}

function restoreStartingSection() {
    const section = getGeneralPreferences().startSection
    if (section === 'all') { setActiveFolder(section) } else { setActiveCategory(section) }
}

function receivePortfolioEmails(emails) {
    for (const email of emails) { addPortfolioEmail(email) }
    flushRemoteMailbox()
    renderEmailList(restorePreferences(''))
    document.dispatchEvent(new Event('dmail:mailbox-data'))
}

async function fetchCatalog(url) {
    const response = await fetch(url)
    if (!response.ok) { throw new Error(`Portfolio data request failed: ${response.status}`) }
    return response.json()
}

function combineCatalogs(catalogs) {
    const emails = {}
    for (const catalog of catalogs) {
        for (const [id, email] of Object.entries(catalog.emails)) {
            if (Object.hasOwn(emails, id)) { throw new Error(`Duplicate portfolio email: ${id}`) }
            emails[id] = email
        }
    }
    return { emails }
}

async function loadCatalog() {
    const source = document.querySelector('meta[name="portfolio-content"]')?.content
    if (source) {
        if (!/^\/script\/content\/catalog\.[a-f0-9]{16}\.json$/.test(source)) { throw new Error('Invalid public content source') }
        return fetchCatalog(source)
    }
    const catalogs = await Promise.all([
        '/api/portfolio/assets/data/emails.json',
        '/api/portfolio/assets/data/writing.json',
    ].map(fetchCatalog))
    return combineCatalogs(catalogs)
}

async function mountMailbox(delivery, previousView) {
    init(delivery.seed, accountCacheAvailable ? loadFolderChoices() : {})
    const notice = accountCacheAvailable ? restorePreferences(await restoreMessages()) : ACCOUNT_CACHE_NOTICE
    if (previousView) {
        const { activeCategory, activeLabel, search } = previousView
        if (!setActiveCategory(activeCategory)) { setActiveFolder(activeCategory) }
        setActiveLabel(activeLabel)
        setSearchQuery(search.query)
    } else { restoreStartingSection() }
    renderEmailList(notice)
    updateOpenThread()
    renderSidebarCounts()
}

function startLifecycle(delivery) {
    delivery.start(receivePortfolioEmails)
    let activity = initActivity()
    let timestamps = initTimestampClock()
    let chatbot = initChatbotMailbox()
    let messageSync = initMessageSync(renderEmailList)

    function prepareReset() {
        delivery.stop()
        activity.stop()
        timestamps.stop()
        chatbot.stop()
        messageSync.stop()
    }

    function resumeMailbox() {
        delivery.start(receivePortfolioEmails)
        activity = initActivity()
        timestamps = initTimestampClock()
        chatbot = initChatbotMailbox()
        messageSync = initMessageSync(renderEmailList)
    }

    initResetLifecycle({ prepare: prepareReset, resume: resumeMailbox })
}

async function initOwnerTools() {
    try {
        const session = await getMessagingSession()
        if (session.owner || session.localOwner) {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'owner-review-button'
            button.textContent = 'Owner review'
            document.querySelector('.sidebar').append(button)
            let loading = false
            async function open() {
                if (loading) { return }
                loading = true
                try {
                    const { initOwnerReview } = await import('./messages/owner-review.js')
                    button.removeEventListener('click', open)
                    initOwnerReview(button)
                    if (!session.owner || !new URLSearchParams(location.search).has('review')) { button.click() }
                } catch (error) { button.title = `Owner tools could not load. Try again. ${error.message}` } finally { loading = false }
            }
            button.addEventListener('click', open)
            if (session.owner && new URLSearchParams(location.search).has('review')) { void open() }
        }
    } catch { /* Public browsing must work when owner tools are unavailable. */ }
}

// Public navigation starts before account I/O; private records wait for verified account restoration.
async function boot() {
    stopMessageSync()
    const isolated = prepareAccountCache()
    const settings = document.querySelector('[data-open-settings]')
    settings.disabled = true
    let accountSettled = false
    let accountRestored = false
    const accountReady = initAccount().then(restored => { accountRestored = restored; accountSettled = true })
    const catalog = await loadCatalog()
    if (!isolated) { await accountReady }
    initForwardConsent()
    initGeneralPreferences()
    let delivery = createDelivery(catalog)
    const reconcile = !accountSettled
    await mountMailbox(delivery)
    delivery.start(receivePortfolioEmails)
    initHandlers({ onMessagesOpened: ids => delivery.opened(ids),
        getReadingProgress: () => delivery.readingProgress(getState().threads, getState().summaryVersion) })
    renderSidebarCounts()
    const ready = performance.now()
    const collect = () => import('./metrics/telemetry.js').then(module => module.initTelemetry(ready)).catch(() => {})
    if ('requestIdleCallback' in window) { requestIdleCallback(collect, { timeout: 3000 }) } else { setTimeout(collect, 0) }
    await accountReady
    if (reconcile && accountRestored) {
        const { activeCategory, activeLabel, search } = getState()
        delivery.stop()
        delivery = createDelivery(catalog)
        const navigated = activeCategory !== 'primary' || activeLabel || search.query
        await mountMailbox(delivery, navigated ? { activeCategory, activeLabel, search } : null)
        document.dispatchEvent(new Event('dmail:general-change'))
    }
    startLifecycle(delivery)
    settings.disabled = false
    void initOwnerTools()
    pollRemoteMailbox().then(added => {
        if (!added) { return }
        renderEmailList(restorePreferences(''))
        document.dispatchEvent(new Event('dmail:mailbox-data'))
    }).catch(error => {
        console.warn('Messaging service unavailable', error)
    })
}

initAbout()
boot().catch((error) => {
    console.error('Unable to load portfolio', error)
    document.querySelector('.email-list').textContent = 'Unable to load the portfolio. Please reload.'
})
