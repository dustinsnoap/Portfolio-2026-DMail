import { initLabels } from '../mailbox/label-ui.js'
import { initMailboxActions } from '../mailbox/mailbox-actions.js'
import { saveConversationRead, toggleSavedStar } from '../mailbox/mailbox-status.js'
import { initMenus } from '../mailbox/menus.js'
import { initReadingPane } from '../mailbox/reading-pane.js'
import { initReadingProgress } from '../mailbox/reading-progress.js'
import {
    renderEmailList, renderExpandedMessage, renderMessageLabels, renderSelection, renderStars, renderThread,
} from '../mailbox/render.js'
import { CATEGORIES, getState, getVisiblePage, getVisibleThreads, selectPageConversations,
    setActiveCategory,
    setActiveFolder, setActiveLabel, setListPage, setSearchQuery, toggleSelectAll,
    toggleSelected } from '../mailbox/state.js'
import { initAttachmentViewer } from '../messages/attachments.js'
import { escapeHtml } from '../messages/content.js'
import { sentSyncNotice } from '../messages/message-sync.js'
import { expandThreadHistory } from '../messages/thread-history.js'
import { isMailboxPath, resolveConversationLink } from '../navigation/conversation-links.js'
import { initKeyboard } from '../navigation/keyboard.js'
import { initMailRoutes } from '../navigation/mail-routes.js'
import { initMobile, initMobileHistory, mobileLayers } from '../navigation/mobile.js'
import { initSearch } from '../search/search-ui.js'
import { initGeneralLinks } from '../settings/general-preferences.js'
import { ensureBodies, ensureSearchContent, hasDeferredBodies, watchDeferredSearch } from '../storage/message-bodies.js'
import { messagingConfigured } from '../storage/portfolio-api.js'
import { initAboutPage } from './about-page.js'
import { initOptionalFeatures } from './optional-features.js'

const CATEGORY_ICONS = { primary: 'inbox', projects: 'projects', articles: 'articles', updates: 'updates' }

export function initHandlers({ onMessagesOpened, getReadingProgress } = {}) {
    const list = document.querySelector('.email-list')
    const mail = document.querySelector('.mail')
    const sidebar = document.querySelector('.sidebar')
    const tabs = document.querySelector('.mail-categories')
    const menus = initMenus()
    const closeMenu = menus.close
    const pane = initReadingPane({ onClose: closeMenu })
    const aboutPage = initAboutPage(mail, pane)
    const mailboxActions = initMailboxActions({ closeConversation: pane.close, closeMenu })
    const mobile = initMobile({
        back: pane.close,
        clearSelection: clearMobileSelection,
        select: selectConversation,
    })
    const labels = initLabels({ onFilter: filterLabels, onApplied: refreshLabels, onAppearanceChanged: renderMessageLabels })
    const { compose, replies, settings, forwarding } = initOptionalFeatures({
        mail, labels, closeMenu, onSent: showSentNotice, onSettingsOpen: closeSettingsOverlays,
    })
    let contentGeneration = 0
    let routes

    function filterLabels() {
        settings.close(false)
        search.reset(false)
        setSearchQuery('')
        pane.close()
        updateCategoryNavigation('all')
        updateFolderNavigation('all')
        renderEmailList()
        routes?.record()
    }

    function refreshLabels() {
        const threadId = mail.dataset.threadId
        renderEmailList()
        if (!pane.isOpen()) { return }
        if (getVisibleThreads().some((thread) => thread.latest.threadId === threadId)) { openThread(threadId) } else { pane.close() }
    }

    function closeSettingsOverlays() {
        mobile.closeDrawer(false)
        mobile.closeSearch()
        search.close()
        closeMenu()
    }

    initGeneralLinks()
    const more = sidebar.querySelector('.toggle')
    const moreFolders = sidebar.querySelector('#more-folders')
    function toggleMoreFolders() {
        const expanded = more.getAttribute('aria-expanded') !== 'true'
        more.setAttribute('aria-expanded', String(expanded))
        more.querySelector('.title').textContent = expanded ? 'Less' : 'More'
        moreFolders.hidden = !expanded
        document.dispatchEvent(new CustomEvent('dmail:folder-toggle'))
    }

    initAttachmentViewer()
    const search = initSearch({ onSearch: searchMailbox })
    watchDeferredSearch(renderEmailList)

    async function searchMailbox(query) {
        const ticket = ++contentGeneration
        settings.close(false)
        try {
            if (query.trim() && hasDeferredBodies()) { await ensureSearchContent() }
        } catch (error) { renderEmailList(`Search could not load message content. ${error.message}`); return }
        if (ticket !== contentGeneration) { return }
        const changed = setSearchQuery(query)
        pane.close()
        closeMenu()
        if (changed) { renderEmailList() }
        routes?.record()
    }

    const notice = document.createElement('div')
    notice.className = 'compose-notice'
    notice.setAttribute('role', 'status')
    notice.hidden = true
    notice.innerHTML =
        '<span>Message saved in this browser. Nothing was sent.</span>' +
        '<button type="button" data-folder="sent">View in Sent</button>' +
        '<button type="button" aria-label="Dismiss notification">×</button>'
    document.body.append(notice)

    let lastSent = null

    function showSentNotice(message) {
        lastSent = message
        renderEmailList()
        notice.querySelector('span').textContent = message?.forwardOf ? 'Forward saved and queued for email delivery.'
            : messagingConfigured() ? sentSyncNotice(message) : 'Message saved in this browser. Nothing was sent.'
        notice.hidden = false
    }

    document.addEventListener('dmail:message-sync', () => {
        if (!notice.hidden && lastSent && !lastSent.forwardOf) {
            notice.querySelector('span').textContent = sentSyncNotice(getState().emails[lastSent.id] ?? lastSent)
        }
    })

    function selectConversation(id) {
        toggleSelected(id)
        renderSelection()
    }

    function updateCategoryNavigation(view) {
        for (const item of tabs.children) {
            const name = CATEGORIES.find((value) => item.classList.contains(value))
            const active = name === view
            item.classList.toggle('active', active)
            const icon = `${CATEGORY_ICONS[name]}-${active ? 'active' : 'inactive'}`
            item.querySelector('use').setAttribute('href', `/api/portfolio/assets/img/sprites.svg#icon-${icon}`)
        }
        tabs.hidden = !CATEGORIES.includes(view)
    }

    function updateFolderNavigation(view) {
        for (const item of sidebar.querySelectorAll('[data-folder]')) {
            const active = item.dataset.folder === view || (item.dataset.folder === 'primary' && CATEGORIES.includes(view))
            item.classList.toggle('active', active)
            if (active) { item.setAttribute('aria-current', 'page') } else { item.removeAttribute('aria-current') }
        }
    }

    function activateView(view, record = true) {
        contentGeneration++
        settings.close(false)
        mobile.closeDrawer(false)
        mobile.closeSearch()
        search.flush()
        search.close()
        setActiveLabel('')
        if (CATEGORIES.includes(view)) { setActiveCategory(view) } else { setActiveFolder(view) }
        updateCategoryNavigation(view)
        updateFolderNavigation(view)
        pane.close()
        closeMenu()
        delete mail.dataset.publicPage
        renderEmailList()
        if (record) { routes?.record() }
    }

    function closeHomeOverlays() {
        if (document.querySelector('.compose-layer:not([hidden])')) { compose.close() }
        for (const popover of document.querySelectorAll('[popover]:popover-open')) { popover.hidePopover() }
        notice.hidden = true
    }

    function goHome(trigger) {
        closeHomeOverlays()
        search.reset(false)
        setSearchQuery('')
        setActiveLabel('')
        activateView('primary')
        const focus = trigger.getClientRects().length && !trigger.closest('[inert]') ? trigger : document.querySelector('.menu-toggle')
        focus.focus({ preventScroll: true })
    }

    function toggleMessageStar(id) {
        let notice = ''
        try { toggleSavedStar(id) } catch (error) { notice = `Star could not be saved. ${error.message}` }
        const { search, activeCategory } = getState()
        if (notice || search.query || activeCategory === 'starred') { renderEmailList(notice) }
        renderStars()
    }

    async function openThread(threadId, record = true) {
        const thread = getState().threads[threadId]
        if (!thread || thread.mailboxFolder === 'hidden') { return false }
        const ticket = ++contentGeneration
        try {
            if (hasDeferredBodies(thread.messages)) { await ensureBodies(thread.messages) }
        } catch (error) { renderEmailList(`Message content could not load. ${error.message}`); return false }
        if (ticket !== contentGeneration || getState().threads[threadId] !== thread) { return false }
        closeMenu()
        delete mail.dataset.publicPage
        let readNotice = ''
        try { saveConversationRead([threadId], true) } catch (error) { readNotice = `Read status could not be saved. ${error.message}` }
        renderThread(threadId)
        renderEmailList(readNotice)
        pane.show()
        document.dispatchEvent(new CustomEvent('dmail:thread-opened', { detail: { threadId } }))
        updateMailboxTitle()
        onMessagesOpened?.([...mail.querySelectorAll('.message:not(.collapsed)')].map(message => message.dataset.id))
        if (!replies.restoreDraft(threadId)) { mail.querySelector('.back').focus({ preventScroll: true }) }
        if (record) { routes?.record() }
        return true
    }

    function replyToThread() {
        mail.querySelector('.thread-reply')?.click()
    }

    initReadingProgress({ read: getReadingProgress, open: threadId => {
        search.reset(false)
        setSearchQuery('')
        activateView('all', false)
        openThread(threadId)
    } })

    initKeyboard({
        openThread,
        back: pane.close,
        isThreadOpen: pane.isOpen,
        reply: replyToThread,
        star: toggleMessageStar,
        select: selectConversation,
    })

    function changeListPage(pageButton) {
        const delta = pageButton.classList.contains('next') ? 1 : -1
        if (setListPage(getVisiblePage().page + delta)) {
            renderEmailList()
            list.scrollTop = 0
        }
    }

    function removeThreadLabel(removeLabel) {
        try {
            labels.removeFromThread(mail.dataset.threadId, removeLabel.dataset.label)
        } catch (error) {
            mail.querySelector('.thread-heading .label-error').textContent = error.message
        }
    }

    function applyLabels(target) {
        const ids = target.closest('.mail') ? [mail.dataset.threadId] : [...getState().selected].map((id) => getState().emails[id].threadId)
        if (!ids.length && pane.isOpen()) { ids.push(mail.dataset.threadId) }
        labels.open(ids)
    }

    function handleRowClick(target, row) {
        if (target.closest('.star')) {
            toggleMessageStar(row.dataset.id)
        } else if (target.closest('.checkbox, .mobile-avatar') || (mobile.isMobile() && getState().selected.size)) {
            selectConversation(row.dataset.id)
        } else {
            openThread(getState().emails[row.dataset.id].threadId)
        }
    }

    function handleNavigationClick(target) {
        const home = target.closest('[data-home]')
        if (home) {
            goHome(home)
            return true
        }
        if (target.closest('.menu-toggle')) {
            if (mobile.isMobile()) { mobile.toggleDrawer() } else { sidebar.classList.toggle('collapsed') }
            return true
        }

        const folder = target.closest('[data-folder]')
        if (folder) {
            activateView(folder.dataset.folder)
            notice.hidden = true
            return true
        }

        const tab = target.closest('.mail-categories .tab')
        if (tab) {
            settings.close(false)
            const category = CATEGORIES.find((name) => tab.classList.contains(name))
            if (getState().activeCategory !== category) { activateView(category) }
            return true
        }

        return false
    }

    function handleMailboxControl(target) {
        const selection = target.closest('[data-select-conversations]')
        if (selection) {
            selectPageConversations(selection.dataset.selectConversations)
            renderSelection()
            closeMenu()
            document.querySelector('.select-options').focus()
            return true
        }
        const pageButton = target.closest('.top-bar .page')
        if (pageButton) {
            changeListPage(pageButton)
            return true
        }

        const removeLabel = target.closest('.remove-thread-label')
        if (removeLabel) {
            removeThreadLabel(removeLabel)
            return true
        }

        if (target.closest('.apply-labels')) {
            applyLabels(target)
            return true
        }
        if (target.closest('[data-file-action], .file-preview')) { return true }

        const menuButton = target.closest('.select-options, .top-bar .other, .mail .options-toggle')
        if (menuButton) {
            const menu = menuButton.closest('.message')?.querySelector('.options') ?? menuButton.parentElement.querySelector('.more-menu')
            menus.toggle(menu, menuButton)
            return true
        }

        if (target.closest('.bulk-select')) {
            toggleSelectAll()
            renderSelection()
            return true
        }
        return false
    }

    function handleConversationClick(target) {
        const history = target.closest('.mail [data-show-thread-history]')
        if (history) { return expandThreadHistory(history) }

        if (target.closest('.mail .back')) {
            pane.close()
            return
        }

        if (target.closest('.reply-form [data-action="discard"]')) { return replies.discardReply() }

        const replyButton = target.closest('.mail .reply, .mail .thread-reply')
        if (replyButton) { return replies.replyToMessage(replyButton) }

        const message = target.closest('.mail .message')
        if (!message) { return }
        if (target.closest('.actions .star')) {
            toggleMessageStar(message.dataset.id)
            return
        }
        if (message === message.parentElement.lastElementChild) { return }
        if (target.closest('.actions, .message > .options')) { return }
        if (message.classList.contains('collapsed') || target.closest('.message-head')) {
            if (message.classList.contains('collapsed')) { renderExpandedMessage(message) }
            delete message.dataset.autoExpanded
            message.classList.toggle('collapsed')
            if (!message.classList.contains('collapsed')) { onMessagesOpened?.([message.dataset.id]) }
        }
    }

    function handleMailClick(event) {
        const target = event.target
        const link = target.closest('a[data-public-link]')
        if (link) {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) { return }
            event.preventDefault()
        }
        menus.closeOutside(target)
        if (forwarding.handleClick(target)) { return }
        const label = target.closest('[data-label-filter]')
        if (label) {
            event.preventDefault()
            labels.filter(label.dataset.labelFilter)
            return
        }
        if (mailboxActions.handle(target)) { return }
        if (handleNavigationClick(target) || handleMailboxControl(target)) { return }
        const row = target.closest('.email-list .email')
        if (row && list.contains(row)) { return handleRowClick(target, row) }
        handleConversationClick(target)
    }

    function handleMailKeys(event) {
        if (event.key === 'Escape') { contentGeneration++ }
        if (replies.submitReplyShortcut(event) || replies.advanceReplySender(event)) { return }
        menus.dismiss(event)
    }

    function bindMailboxEvents() {
        more.addEventListener('click', toggleMoreFolders)
        notice.querySelector('[aria-label="Dismiss notification"]').addEventListener('click', () => {
            notice.hidden = true
        })
        document.addEventListener('click', handleMailClick)
        document.addEventListener('keydown', handleMailKeys)
    }

    function restoreNavigation() {
        const section = getState().activeCategory
        updateCategoryNavigation(section)
        updateFolderNavigation(section)
        if (section === 'all' && !mobile.isMobile() && moreFolders.hidden) { toggleMoreFolders() }
    }

    bindMailboxEvents()
    restoreNavigation()
    const historyOwner = initMobileHistory({ readLayers: () => mobileLayers({ pane, mobile, settings, compose, replies, search, menus,
        clearSelection: clearMobileSelection, isSelected: () => getState().selected.size > 0,
    }).filter(layer => layer.key !== 'thread'),
    })
    routes = initMailRoutes({ read: readMailboxRoute, apply: applyMailboxRoute, historyOwner })
    document.addEventListener('dmail:thread-close', () => { contentGeneration++; updateMailboxTitle(); routes.record() })
    document.addEventListener('dmail:list-render', updateMailboxTitle)
    document.addEventListener('dmail:auth-close', updateMailboxTitle)
    document.addEventListener('dmail:mailbox-data', () => {
        if (pane.isOpen() && !aboutPage.isOpen() && !getState().threads[mail.dataset.threadId]) {
            replies.closeReply()
            pane.close()
            mail.querySelector('.thread-stack')?.replaceChildren()
        }
    })
    updateMailboxTitle()

    function updateMailboxTitle() {
        if (!isMailboxPath(location.pathname)) { return }
        if (aboutPage.isOpen()) {
            document.title = `${mail.querySelector('h1').textContent} · Dmail`
            return
        }
        const { activeCategory, activeLabel } = getState()
        const names = { primary: 'Inbox', articles: 'Writing', all: 'All Mail' }
        const subject = pane.isOpen() ? getState().threads[mail.dataset.threadId]?.messages[0].data.subject : ''
        const title = subject || activeLabel || names[activeCategory] || activeCategory[0].toUpperCase() + activeCategory.slice(1)
        document.title = `${title} · Dmail`
    }

    function readMailboxRoute() {
        const { activeCategory, activeLabel, search } = getState()
        return { view: activeCategory, label: activeLabel, query: search.query,
            thread: pane.isOpen() ? mail.dataset.threadId || '' : '', page: aboutPage.isOpen() ? 'about' : '' }
    }

    async function applyMailboxRoute(route) {
        search.reset(false)
        setSearchQuery('')
        activateView(route.view, false)
        if (route.label) { setActiveLabel(route.label) }
        document.querySelector('.searchbox').value = route.query
        const ticket = contentGeneration
        if (route.query && hasDeferredBodies()) {
            try { await ensureSearchContent() } catch (error) {
                renderEmailList(`Search could not load message content. ${error.message}`)
                return false
            }
            if (ticket !== contentGeneration) { return false }
        }
        setSearchQuery(route.query)
        renderEmailList()
        if (route.page === 'about') { return aboutPage.show() }
        if (!route.thread) { return true }
        const thread = resolveConversationLink(route.thread, getState().threads)
        if (thread) { return openThread(thread, false) }
        renderEmailList('This conversation is not available in this mailbox. Sign in to restore conversations saved to your account.')
        return false
    }
}

function clearMobileSelection() {
    getState().selected.clear()
    renderSelection()
}
