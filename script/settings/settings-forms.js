import { CHATBOT_NAME } from '../app/identity.js'
import { escapeHtml } from '../messages/content.js'
import { clearSearchHistory } from '../search/search-history.js'
import { apiJSON, getMessagingSession, messagingConfigured } from '../storage/portfolio-api.js'
import { GENERAL_DEFAULTS, normalizeGeneral, START_SECTIONS } from './general-preferences.js'
import { loadPreferences, savePreferences } from './preferences.js'

function toggleSetting(label, key, value, description) {
    return `<div class="general-option"><label><input type="checkbox" data-general="${key}"${value ? ' checked' : ''}>${label}</label>
        <p>${description}</p></div>`
}

export function buildGeneralSettings(preferences) {
    const general = normalizeGeneral(preferences.general)
    const sections = Object.entries(START_SECTIONS).map(([value, label]) =>
        `<option value="${value}"${general.startSection === value ? ' selected' : ''}>${label}</option>`).join('')
    return `<p class="settings-intro">Choose how you browse and interact with this portfolio. Preferences are saved for your next visit.</p>
        ${settingsRow('Keyboard', `
            ${toggleSetting('Enable single-key shortcuts', 'shortcuts', general.shortcuts,
                'Use j / k to navigate, c to compose, r to reply, and / to search. Tab navigation and standard control keys stay enabled.')}
            ${toggleSetting('Enable Ctrl / ⌘ + Enter to send', 'sendShortcut', general.sendShortcut,
                'Send the current reply or composed message with a keyboard shortcut.')}
            <button type="button" data-shortcut-guide>View keyboard shortcuts</button>
        `)}${settingsRow('Browsing', `
            <label class="general-select">Starting section
                <select data-general="startSection" aria-label="Starting section">${sections}</select></label>
            <p>Open here on your next visit. Changing this keeps your current conversation in place.</p>
            ${toggleSetting('Open external links in a new tab', 'externalLinks', general.externalLinks,
                'Keep the portfolio open when you visit project websites or other external links.')}
        `)}${settingsRow('Recent searches', `
            ${toggleSetting('Remember recent searches', 'rememberSearches', general.rememberSearches,
                'Keep up to six submitted searches in this browser. Turning this off hides the list and stops saving new searches.')}
            <button type="button" data-clear-searches>Clear recent searches</button>
            <p>This removes the saved search list; your current search and conversations stay in place.</p>
            <p class="general-status" role="status"></p>
        `)}${settingsRow(`${escapeHtml(CHATBOT_NAME)} memory`, `
            <button type="button" data-forget-chatbot>Forget me</button>
            <p>Clear what ${escapeHtml(CHATBOT_NAME)} remembers about you and cancel pending replies. Your inbox history stays available.</p>
            <p class="chatbot-memory-status" role="status"></p>
        `)}${settingsRow('Browser reset', `
            <button type="button" data-reset-browser>Reset mailbox and cache</button>
            <p>Return this browser's mailbox to its first-visit state and refresh app files.
                Archived emails return to their original inbox sections.
                Saved messages, replies, attachments, stars, searches, and opening progress are erased.
                All settings, colors, fonts, labels, and Trash/Spam decisions stay. Permanently deleted conversations stay hidden.
                  Unsent drafts close when the page reloads.</p>
            <p class="browser-reset-status" role="status"></p>
        `)}<button type="button" data-reset-general>Reset general settings</button>`
}

function restoreGeneralControls(view) {
    const general = normalizeGeneral(loadPreferences().general)
    for (const control of view.querySelectorAll('[data-general]')) {
        if (control.type === 'checkbox') {
            control.checked = general[control.dataset.general]
        } else { control.value = general[control.dataset.general] }
    }
}

function saveGeneral(view, general) {
    try {
        savePreferences({ general: normalizeGeneral(general) })
        document.dispatchEvent(new Event('dmail:general-change'))
        view.querySelector('.label-error').textContent = ''
    } catch (error) {
        view.querySelector('.label-error').textContent = `General settings could not be saved. ${error.message}`
    }
    try { restoreGeneralControls(view) } catch { }
}

export function initGeneralSettings(view) {
    initChatbotSettings(view)
    function changeGeneral(event) {
        const control = event.target.closest('[data-general]')
        if (!control || !Object.hasOwn(GENERAL_DEFAULTS, control.dataset.general)) { return }
        try {
            const general = normalizeGeneral(loadPreferences().general)
            const value = control.type === 'checkbox' ? control.checked : control.value
            saveGeneral(view, { ...general, [control.dataset.general]: value })
        } catch (error) { view.querySelector('.label-error').textContent = error.message }
    }

    function clearSearches() {
        try {
            clearSearchHistory()
            document.dispatchEvent(new Event('dmail:search-history-change'))
            view.querySelector('.general-status').textContent = 'Recent searches cleared.'
            view.querySelector('.label-error').textContent = ''
        } catch (error) { view.querySelector('.label-error').textContent = `Recent searches could not be cleared. ${error.message}` }
    }

    function handleGeneralClick(event) {
        if (event.target.closest('[data-shortcut-guide]')) { document.dispatchEvent(new Event('dmail:show-shortcuts')) }
        if (event.target.closest('[data-clear-searches]')) { clearSearches() }
        if (event.target.closest('[data-reset-general]')) { saveGeneral(view, GENERAL_DEFAULTS) }
    }

    view.addEventListener('change', changeGeneral)
    view.addEventListener('click', handleGeneralClick)
}

const display = globalThis.DmailDisplay

function selectSetting(label, key, choices, selected) {
    return `<label>${label}<select data-appearance="${key}" aria-label="${label}">${choices.map(([value, name]) =>
        `<option value="${value}"${String(value) === String(selected) ? ' selected' : ''}>${name}</option>`).join('')}</select></label>`
}

function colorSetting(label, key, value, fallback, description) {
    return `<div class="appearance-color"><label><span>${label}</span>
        <input type="color" data-appearance="${key}" aria-label="${label}" value="${value || fallback}">
        <output>${value || fallback}</output></label><button type="button" data-default-color="${key}">Default</button>
        <p>${description}</p></div>`
}

export function basicAppearanceControls(preferences) {
    const appearance = display.normalize(preferences.appearance)
    const theme = ['dark', 'light', 'system'].includes(preferences.theme) ? preferences.theme : 'system'
    return {
        theme: selectSetting('Theme', 'theme', [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], theme),
        font: selectSetting('Font', 'font', Object.entries(display.fonts).map(([id, font]) => [id, font.name]), appearance.font),
        spacing: selectSetting('Reading line spacing', 'lineSpacing', [['normal', 'Normal'], ['relaxed', 'Relaxed']], appearance.lineSpacing),
        density: selectSetting('Density', 'density', [['compact', 'Compact'], ['default', 'Default'], ['roomy', 'Roomy']], appearance.density),
        size: selectSetting('Text size', 'size', [[12, 'Small'], [14, 'Default'], [16, 'Large'], [18, 'Extra large']], appearance.size),
    }
}

export function buildAppearanceSettings(preferences) {
    const appearance = display.normalize(preferences.appearance)
    const basic = basicAppearanceControls(preferences)
    const accent = document.documentElement.dataset.theme === 'light' ? '#0b57d0' : '#a8c7fa'
    const fontStatus = escapeHtml(document.documentElement.dataset.fontStatus || '')
    return `<p class="settings-intro">Choose how this portfolio looks. Your preferences are saved for your next visit.</p>
        ${settingsRow('Theme', basic.theme)}
        ${settingsRow('Colors', `<div class="appearance-grid">
            ${colorSetting('Primary color', 'primary', appearance.primary, '#0b57d0',
                'Send buttons and main actions. Compose follows the theme.')}
            ${colorSetting('Accent color', 'accent', appearance.accent, accent, 'Highlights, links, and focus outlines.')}
        </div>`)}
        ${settingsRow('Typography', `<div class="appearance-grid">
            ${basic.font}${basic.size}${basic.spacing}
        </div><p class="appearance-font-status" role="status">${fontStatus}</p>`)}
        ${settingsRow('Conversation list', `<div class="appearance-grid">
            ${basic.density}
        </div><label class="appearance-preview"><input type="checkbox" data-appearance="preview"${appearance.preview ? ' checked' : ''}>
            Show message preview text</label>`)}
        ${settingsRow('Animations', selectSetting('Animations', 'motion',
            [['system', 'System'], ['full', 'Full'], ['reduced', 'Reduced']], appearance.motion))}
        ${settingsRow('Preview', `<div class="appearance-sample" aria-label="Appearance preview"><strong>Your portfolio, your view.</strong>
            <span>Projects, writing, and updates.</span><span class="appearance-sample-button">Primary button</span></div>`)}
        <button type="button" data-reset-appearance>Reset appearance</button>`
}

function restoreAppearanceControls(view) {
    const preferences = loadPreferences()
    const appearance = display.normalize(preferences.appearance)
    const accent = document.documentElement.dataset.theme === 'light' ? '#0b57d0' : '#a8c7fa'
    for (const control of view.querySelectorAll('[data-appearance]')) {
        const key = control.dataset.appearance
        const value = key === 'theme' ? preferences.theme || 'system' : appearance[key]
        if (control.type === 'checkbox') { control.checked = value } else { control.value = value || (key === 'primary' ? '#0b57d0' : accent) }
        if (control.type === 'color') { control.parentElement.querySelector('output').value = control.value }
    }
}

function commitAppearance(changes) {
    savePreferences(changes)
    document.dispatchEvent(new CustomEvent('dmail:appearance-change'))
}

function saveChange(view, changes) {
    try {
        commitAppearance(changes)
        view.querySelector('.label-error').textContent = ''
    } catch (error) {
        view.querySelector('.label-error').textContent = `Appearance could not be saved. ${error.message}`
    }
    try { restoreAppearanceControls(view) } catch { }
}

export function initAppearanceSettings(view) {
    function changeAppearance(event) {
        const control = event.target.closest('[data-appearance]')
        if (!control) { return }
        const key = control.dataset.appearance
        const value = control.type === 'checkbox' ? control.checked : key === 'size' ? Number(control.value) : control.value
        if (key === 'theme') { return saveChange(view, { theme: value }) }
        try {
            const appearance = display.normalize(loadPreferences().appearance)
            saveChange(view, { appearance: display.normalize({ ...appearance, [key]: value }) })
        } catch (error) { view.querySelector('.label-error').textContent = error.message }
    }

    function resetAppearance(event) {
        const color = event.target.closest('[data-default-color]')
        if (event.target.closest('[data-reset-appearance]')) { return saveChange(view, { theme: 'system', appearance: display.defaults }) }
        if (!color) { return }
        try {
            const appearance = display.normalize(loadPreferences().appearance)
            saveChange(view, { appearance: { ...appearance, [color.dataset.defaultColor]: '' } })
        } catch (error) { view.querySelector('.label-error').textContent = error.message }
    }

    function showFontStatus(event) {
        const status = view.querySelector('.appearance-font-status')
        if (status) { status.textContent = event.detail }
    }

    view.addEventListener('change', changeAppearance)
    view.addEventListener('click', resetAppearance)
    document.addEventListener('dmail:font-status', showFontStatus)
}

export function settingsRow(title, content) {
    return `<div class="settings-row"><h3>${title}</h3><div class="settings-row-content">${content}</div></div>`
}

export function initChatbotSettings(view) {
    // Reset the server before renewing the browser memory ID, or old chatbot work could survive.
    async function forgetChatbot(button) {
        const status = view.querySelector('.chatbot-memory-status')
        button.disabled = true
        try {
            if (!messagingConfigured()) { throw new Error(`${CHATBOT_NAME} is unavailable in this preview.`) }
            await getMessagingSession()
            await apiJSON('/chatbot/forget', {})
            await getMessagingSession(true)
            status.textContent = `${CHATBOT_NAME}'s memory is cleared and pending replies are canceled. Your messages are still here.`
        } catch (error) {
            status.textContent = `${CHATBOT_NAME}'s memory could not be cleared. ${error.message}`
        } finally {
            button.disabled = false
        }
    }

    function handleForget(event) {
        const button = event.target.closest('[data-forget-chatbot]')
        if (button && !button.disabled) { void forgetChatbot(button) }
    }

    view.addEventListener('click', handleForget)
}
