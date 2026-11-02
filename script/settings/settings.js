import { LABEL_COLORS, labelAppearance } from '../mailbox/labels.js'
import { escapeHtml } from '../messages/content.js'
import { initBrowserReset } from './browser-reset.js'
import { loadPreferences } from './preferences.js'
import { basicAppearanceControls, buildAppearanceSettings, buildGeneralSettings, initAppearanceSettings,
    initGeneralSettings, settingsRow } from './settings-forms.js'

function labelSetting(name, preferences) {
    const appearance = labelAppearance(name, preferences)
    return `<div class="label-setting" data-name="${escapeHtml(name)}">
                    <span class="topic-label" style="--label-background:${appearance.background};--label-text:${appearance.text}">${escapeHtml(
                        name,
                    )}</span>
                    <label>Color<select data-setting="color" aria-label="Color for ${escapeHtml(name)}">${LABEL_COLORS.map(
                        (color) => `<option${color.name === appearance.name ? ' selected' : ''}>${color.name}</option>`,
                    ).join('')}</select></label>
                    <label><input type="checkbox" data-setting="sidebar" aria-label="Show ${escapeHtml(name)} in sidebar"${
                        appearance.sidebar ? ' checked' : ''
                    }>Above More</label>
                    <label><input type="checkbox" data-setting="messages" aria-label="Show ${escapeHtml(name)} on messages"${
                        appearance.messages ? ' checked' : ''
                    }>Messages</label>
                    <button type="button" data-remove aria-label="Remove ${escapeHtml(name)} everywhere">Remove</button>
                </div>`
}

function buildLabelSettings(labels, preferences) {
    const rows = labels.list().map((name) => labelSetting(name, preferences)).join('')
    return `<p>Organize projects, writing, and updates. Changes are saved automatically.
        Uncheck Above More to put a label in the sidebar's More section. Removing a label keeps its conversations.</p>
        <div class="label-settings-list">${rows || '<p>No labels yet. Create one below.</p>'}</div>
        <form class="create-label"><label>New label<input name="label-name" maxlength="40" autocomplete="off"
            placeholder="e.g. Backend, Projects, Career"></label><button type="submit">Create label</button></form>`
}

async function loadMetrics(panel) {
    if (!document.querySelector('[data-metrics-style]')) {
        const stylesheet = document.createElement('link')
        stylesheet.rel = 'stylesheet'
        stylesheet.href = '/style/settings/metrics.css'
        stylesheet.dataset.metricsStyle = 'true'
        document.head.append(stylesheet)
    }
    try {
        const { mountMetrics } = await import('../metrics/metrics-page.js')
        if (panel.isConnected) { mountMetrics(panel) }
    } catch { if (panel.isConnected) { panel.textContent = 'Metrics could not be loaded. Reopen this tab to retry.' } }
}

export function initSettings(labels, { onOpen } = {}) {
    const app = document.querySelector('.app')
    const mailbox = app.querySelector('.mailbox')
    const views = mailbox.querySelector('.mail-views')
    const view = document.createElement('section')
    view.id = 'portfolio-settings'
    view.className = 'settings-view'
    view.hidden = true
    view.setAttribute('aria-labelledby', 'settings-title')
    mailbox.append(view)
    initGeneralSettings(view)
    initBrowserReset(view)
    initAppearanceSettings(view)
    let activeTab = 'general'
    let returnFocus = null
    const quick = initQuickSettings({ onAll: openFullSettings, onOpen })

    function showTab(tab, focus = false) {
        activeTab = tab
        if (tab === 'metrics') { loadMetrics(view.querySelector('[data-settings-panel="metrics"]')) }
        view.querySelector('.settings-body').scrollTop = 0
        for (const button of view.querySelectorAll('[role="tab"]')) {
            const active = button.dataset.settingsTab === tab
            button.setAttribute('aria-selected', String(active))
            button.tabIndex = active ? 0 : -1
            if (active && focus) { button.focus() }
        }
        for (const panel of view.querySelectorAll('[role="tabpanel"]')) { panel.hidden = panel.dataset.settingsPanel !== tab }
    }

    function navigateTabs(event) {
        const tab = event.target.closest('[role="tab"]')
        if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { return }
        event.preventDefault()
        const sections = ['general', 'appearance', 'labels', 'metrics']
        const direction = event.key === 'ArrowRight' ? 1 : -1
        const position = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
            : (sections.indexOf(activeTab) + direction + sections.length) % sections.length
        showTab(sections[position], true)
    }

    view.addEventListener('keydown', navigateTabs)

    function render() {
        const preferences = loadPreferences()
        view.innerHTML =
            `<div class="settings-heading"><h2 id="settings-title">Settings</h2></div>
            <div class="settings-tabs" role="tablist" aria-label="Settings sections">
                <button type="button" id="general-tab" role="tab" data-settings-tab="general"
                    aria-controls="general-settings">General</button>
                <button type="button" id="appearance-tab" role="tab" data-settings-tab="appearance"
                    aria-controls="appearance-settings">Appearance</button>
                <button type="button" id="labels-tab" role="tab" data-settings-tab="labels"
                    aria-controls="label-settings">Labels</button>
                <button type="button" id="metrics-tab" role="tab" data-settings-tab="metrics"
                    aria-controls="metrics-settings">Metrics</button>
            </div>
            <div class="settings-body"><section id="general-settings" role="tabpanel" data-settings-panel="general"
                aria-labelledby="general-tab">${buildGeneralSettings(preferences)}</section>
            <section id="appearance-settings" role="tabpanel" data-settings-panel="appearance"
                aria-labelledby="appearance-tab">${buildAppearanceSettings(preferences)}</section>
            <section id="label-settings" role="tabpanel" data-settings-panel="labels" aria-labelledby="labels-tab">
            ${settingsRow('Labels', buildLabelSettings(labels, preferences))}</section>
            <section id="metrics-settings" role="tabpanel" data-settings-panel="metrics" aria-labelledby="metrics-tab" hidden></section>
            <p class="label-error" role="alert"></p><div class="settings-actions">` +
            '<span>Changes are saved automatically.</span><button type="button" data-close>Done</button></div></div>'
        showTab(activeTab)
    }

    function report(action) {
        try {
            action()
            view.querySelector('.label-error').textContent = ''
        } catch (error) {
            view.querySelector('.label-error').textContent = error.message
        }
    }

    function close(restoreFocus = true) {
        quick.close(restoreFocus)
        if (view.hidden) { return }
        view.hidden = true
        app.classList.remove('settings-open')
        views.inert = false
        if (restoreFocus) {
            const back = app.querySelector('.mail .back')
            const fallback = back?.getClientRects().length ? back : app.querySelector('.menu-toggle')
            const target = returnFocus?.getClientRects().length ? returnFocus : fallback
            target?.focus({ preventScroll: true })
        }
    }

    function openFullSettings() {
        quick.close(false)
        onOpen?.()
        activeTab = 'general'
        document.querySelector('#about-panel')?.hidePopover()
        try {
            render()
        } catch (error) {
            view.innerHTML =
                '<div class="settings-heading"><h2 id="settings-title">Settings</h2></div>' +
                `<p role="alert">${escapeHtml(error.message)}</p><button type="button" data-close>Done</button>`
        }
        view.hidden = false
        app.classList.add('settings-open')
        views.inert = true
        const focusTarget = view.querySelector('[aria-selected="true"]') ?? view.querySelector('[data-close]')
        focusTarget.focus({ preventScroll: true })
    }

    function openSettings(event) {
        const trigger = event.target.closest('[data-open-settings]')
        if (!trigger) { return }
        if (quick.isOpen()) { return close() }
        close(false)
        returnFocus = trigger
        if (window.matchMedia('(width >= 800px)').matches) { quick.open(trigger) } else { openFullSettings() }
    }

    document.addEventListener('click', openSettings)
    function handleSettingsClick(event) {
        if (event.target.closest('[data-close]')) { return close() }
        const tab = event.target.closest('[role="tab"]')
        if (tab) { return showTab(tab.dataset.settingsTab) }
        const button = event.target.closest('[data-remove]')
        if (!button) { return }
        const row = button.closest('.label-setting')
        const next = row.nextElementSibling?.querySelector('select') ?? row.previousElementSibling?.querySelector('select')
        report(() => {
            labels.remove(row.dataset.name)
            row.remove()
            ;(next ?? view.querySelector('[name="label-name"]')).focus()
        })
    }

    view.addEventListener('click', handleSettingsClick)
    function configureLabel(event) {
        const control = event.target.closest('[data-setting]')
        if (!control) { return }
        const row = control.closest('.label-setting')
        report(() => {
            labels.configure(row.dataset.name, { [control.dataset.setting]: control.type === 'checkbox' ? control.checked : control.value })
            const appearance = labelAppearance(row.dataset.name, loadPreferences())
            const chip = row.querySelector('.topic-label')
            chip.style.setProperty('--label-background', appearance.background)
            chip.style.setProperty('--label-text', appearance.text)
        })
        try {
            const saved = labelAppearance(row.dataset.name, loadPreferences())
            if (control.type === 'checkbox') { control.checked = saved[control.dataset.setting] } else { control.value = saved.name }
        } catch {
        }
    }

    view.addEventListener('change', configureLabel)
    function createLabel(event) {
        event.preventDefault()
        const value = view.querySelector('[name="label-name"]').value
        report(() => {
            labels.create(value)
            render()
            view.querySelector('[name="label-name"]').focus()
        })
    }

    view.addEventListener('submit', createLabel)
    return { close }
}

export function initQuickSettings({ onAll, onOpen }) {
    const app = document.querySelector('.app')
    const trigger = app.querySelector('.portfolio-settings')
    const desktop = window.matchMedia('(width >= 800px)')
    const panel = document.createElement('aside')
    panel.id = 'quick-settings'
    panel.className = 'quick-settings'
    panel.hidden = true
    panel.setAttribute('aria-labelledby', 'quick-settings-title')
    app.querySelector('.workspace').append(panel)
    initAppearanceSettings(panel)
    let returnFocus = null

    function updateTrigger() {
        trigger.setAttribute('aria-controls', desktop.matches ? 'quick-settings' : 'portfolio-settings')
        trigger.setAttribute('aria-expanded', String(!panel.hidden))
    }

    function close(restoreFocus = true) {
        if (panel.hidden) { return }
        panel.hidden = true
        app.classList.remove('quick-settings-open')
        updateTrigger()
        if (restoreFocus && returnFocus?.getClientRects().length) { returnFocus.focus({ preventScroll: true }) }
    }

    function open(source) {
        if (!desktop.matches) { return }
        returnFocus = source
        onOpen?.()
        for (const popover of document.querySelectorAll('[popover]:popover-open')) { popover.hidePopover() }
        let controls = ''
        let error = ''
        try { controls = Object.values(basicAppearanceControls(loadPreferences())).join('') } catch (problem) {
            error = escapeHtml(problem.message)
        }
        panel.innerHTML = `<header class="quick-settings-heading"><h2 id="quick-settings-title">Quick settings</h2>
            <button type="button" data-close-quick aria-label="Close quick settings">×</button></header>
            <button type="button" class="quick-settings-all" data-all-settings>See all settings</button>
            <div class="quick-settings-body">${controls}
            <p class="appearance-font-status" role="status">${escapeHtml(document.documentElement.dataset.fontStatus || '')}</p>
            <p class="label-error" role="alert">${error}</p><p class="quick-settings-note">Changes are saved automatically.</p></div>`
        panel.hidden = false
        app.classList.add('quick-settings-open')
        updateTrigger()
        panel.querySelector('[data-close-quick]').focus({ preventScroll: true })
    }

    function click(event) {
        if (event.target.closest('[data-close-quick]')) { close() }
        if (event.target.closest('[data-all-settings]')) { close(false); onAll() }
    }

    // Let native select controls consume Escape before dismissing the panel.
    function dismiss(event) {
        if (panel.hidden || event.defaultPrevented || event.key !== 'Escape' || event.target.closest('select')) { return }
        if (document.querySelector('dialog[open], [popover]:popover-open')) { return }
        event.preventDefault()
        close()
    }

    function resize() {
        if (!desktop.matches) { close(false) }
        updateTrigger()
    }

    panel.addEventListener('click', click)
    document.addEventListener('keydown', dismiss)
    desktop.addEventListener('change', resize)
    updateTrigger()
    return { open, close, isOpen: () => !panel.hidden }
}
