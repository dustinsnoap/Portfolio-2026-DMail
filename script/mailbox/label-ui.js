import { spriteIcon } from '../app/icons.js'
import { escapeHtml } from '../messages/content.js'
import { loadPreferences, savePreferences } from '../settings/preferences.js'
import {
    availableLabels, hasLabel, labelAppearance, labelAssignments, normalizeLabels, removeLabelPreferences, threadLabels,
} from './labels.js'
import { formatSidebarCount } from './sidebar-counts.js'
import { getState, getVisibleThreads, setActiveFolder, setActiveLabel, setThreadLabels } from './state.js'

export function restoreLabels(preferences = loadPreferences()) {
    for (const [id, labels] of Object.entries(labelAssignments(getState().threads, preferences))) { setThreadLabels(id, labels) }
}

export function initLabels({ onFilter, onApplied, onAppearanceChanged }) {
    const sidebar = document.createElement('section')
    sidebar.className = 'sidebar-labels'
    sidebar.setAttribute('aria-label', 'Filter by label')
    document.querySelector('.sidebar').append(sidebar)
    const dialog = document.createElement('dialog')
    dialog.className = 'label-dialog feature-dialog'
    dialog.setAttribute('aria-labelledby', 'label-dialog-title')
    document.body.append(dialog)
    let targets = []
    let sidebarMarkup = ''
    let expanded = false
    let summary

    function list() {
        return availableLabels(getState().threads, loadPreferences())
    }

    function commit(changes) {
        const preferences = savePreferences(changes)
        restoreLabels(preferences)
        pruneSelection()
        onApplied()
    }

    function pruneSelection() {
        const { activeLabel, selected } = getState()
        if (activeLabel && !hasLabel(list(), activeLabel)) { setActiveLabel('') }
        const visible = new Set(getVisibleThreads().map((thread) => thread.latest.id))
        for (const id of selected) { if (!visible.has(id)) { selected.delete(id) } }
    }

    function sidebarSummary(preferences) {
        const state = getState()
        const custom = JSON.stringify([preferences.labels, preferences.removedLabels])
        if (summary?.state !== state || summary.version !== state.summaryVersion || summary.custom !== custom) {
            summary = { state, version: state.summaryVersion, custom, names: availableLabels(state.threads, preferences),
                counts: countLabels(state.index.all.map(id => state.threads[id])) }
        }
        return summary
    }

    function render() {
        const { activeLabel } = getState()
        let preferences = {}
        try {
            preferences = loadPreferences()
        } catch {
        }
        const { names, counts } = sidebarSummary(preferences)
        const markup = buildLabelSidebar(names, counts, activeLabel, preferences, expanded)
        if (markup === sidebarMarkup) { return }
        sidebar.innerHTML = markup
        sidebarMarkup = markup
    }

    function open(threadIds = []) {
        targets = [...new Set(threadIds)]
        dialog.innerHTML =
            `<div class="dialog-heading"><h2 id="label-dialog-title">${
                targets.length ? 'Apply labels' : 'Create label'
            }</h2><button type="button" data-close aria-label="Close labels">×</button></div>
            <p>${
                targets.length ? 'Organize this conversation in your saved view.' : 'Use labels to organize projects, writing, and personal updates.'
            }</p>
            <div class="label-choices"></div>
            <label>New label<input name="label-name" maxlength="40" autocomplete="off"></label>
            <button type="button" data-create>Create</button><p class="label-error" role="alert"></p>
            <div class="dialog-actions"><button type="button" data-apply>${
                targets.length ? 'Apply' : 'Done'
            }</button><button type="button" data-close>Cancel</button></div>`
        if (targets.length) { for (const name of list()) { addChoice(dialog.querySelector('.label-choices'), name) } }
        dialog.showModal()
        if (!targets.length) { dialog.querySelector('[name="label-name"]').focus() }
    }

    function addChoice(container, name, created = false) {
        const row = document.createElement('label')
        row.innerHTML = `<input type="checkbox" value="${escapeHtml(name)}">${escapeHtml(name)}`
        const checkbox = row.querySelector('input')
        const count = targets.filter((id) => hasLabel(threadLabels(getState().threads[id]), name)).length
        checkbox.checked = created || (targets.length > 0 && count === targets.length)
        checkbox.indeterminate = count > 0 && count < targets.length
        container.append(row)
    }

    function create(value) {
        const name = normalizeLabels([value])[0]
        const names = list()
        if (hasLabel(names, name)) { throw new Error('That label already exists.') }
        if (names.length >= 50) { throw new Error('Use up to 50 labels.') }
        const preferences = loadPreferences()
        commit({
            labels: [...(preferences.labels ?? []), name],
            removedLabels: (preferences.removedLabels ?? []).filter((label) => label !== name.toLowerCase()),
        })
        return name
    }

    function handleSidebarClick(event) {
        if (event.target.closest('[data-add-label]')) { return open() }
        if (event.target.closest('[data-more-labels]')) {
            expanded = !expanded
            render()
            sidebar.querySelector('[data-more-labels]').focus({ preventScroll: true })
            return
        }
        const button = event.target.closest('[data-label], .label-clear')
        if (!button) { return }
        filter(button.dataset.label ?? '')
    }

    // Label filters intentionally span every mailbox tab.
    function filter(name) {
        setActiveFolder('all')
        setActiveLabel(name)
        onFilter()
    }

    function createDialogLabel() {
        const input = dialog.querySelector('[name="label-name"]')
        const name = create(input.value)
        if (targets.length) { addChoice(dialog.querySelector('.label-choices'), name, true) }
        input.value = ''
        dialog.querySelector('.label-error').textContent = `Created ${name}.`
    }

    // An indeterminate choice leaves that label's existing assignments unchanged.
    function applyDialogLabels() {
        const saved = { ...(loadPreferences().threadLabels ?? {}) }
        const choices = [...dialog.querySelectorAll('.label-choices input')]
        for (const id of targets) {
            const current = threadLabels(getState().threads[id])
            saved[id] = normalizeLabels(choices.filter(input => input.checked || (input.indeterminate && current.includes(input.value)))
                .map(input => input.value))
        }
        commit({ threadLabels: saved })
        dialog.close()
    }

    function handleDialogClick(event) {
        if (event.target.closest('[data-close]')) { return dialog.close() }
        try {
            if (event.target.closest('[data-create]')) { createDialogLabel() }
            if (event.target.closest('[data-apply]')) { applyDialogLabels() }
        } catch (failure) {
            dialog.querySelector('.label-error').textContent = failure.message
        }
    }

    sidebar.addEventListener('click', handleSidebarClick)
    dialog.addEventListener('click', handleDialogClick)
    document.addEventListener('dmail:list-render', render)
    render()

    function configure(name, changes) {
        const appearance = loadPreferences().labelAppearance ?? {}
        const key = name.toLowerCase()
        savePreferences({ labelAppearance: { ...appearance, [key]: { ...appearance[key], ...changes } } })
        render()
        onAppearanceChanged()
    }

    function remove(name) {
        commit(removeLabelPreferences(getState().threads, loadPreferences(), name))
    }

    function removeFromThread(id, name) {
        const labels = threadLabels(getState().threads[id]).filter((label) => label.toLowerCase() !== name.toLowerCase())
        commit({ threadLabels: { ...loadPreferences().threadLabels, [id]: labels } })
    }
    return { open, list, create, configure, remove, removeFromThread, filter }
}

function countLabels(threads) {
    const counts = new Map()
    for (const thread of threads) {
        for (const label of threadLabels(thread)) {
            const key = label.toLowerCase()
            counts.set(key, (counts.get(key) ?? 0) + 1)
        }
    }
    return counts
}

const ICON_COLORS = Object.freeze({ Gray: 'var(--gmail-muted)', Blue: '#4a86e8', Green: '#16a766', Yellow: '#fad165',
    Orange: '#ffad47', Red: '#fb4c2f', Purple: '#a479e2', Pink: '#f691b3' })

export function buildLabelSidebar(names, counts, activeLabel, preferences, expanded = false) {
    const primary = names.filter(name => labelAppearance(name, preferences).sidebar)
    const more = names.filter(name => !labelAppearance(name, preferences).sidebar)
    return (
        '<div class="labels-heading"><h2>Labels</h2>' +
        `<button type="button" data-add-label aria-label="Create label" title="Create label">+</button></div>
        ${activeLabel ? '<button type="button" class="label-clear">Clear label filter ×</button>' : ''}
        ${primary.map((label) => labelButton(label, counts, activeLabel, preferences)).join('')}
        ${more.length ? `<button type="button" class="label-filter label-more-toggle" data-more-labels
            aria-expanded="${expanded}" aria-controls="more-labels"><span>${expanded ? 'Less' : 'More'}</span>
            <small>${more.length} labels</small></button><div id="more-labels"${expanded ? '' : ' hidden'}>` +
            more.map(label => labelButton(label, counts, activeLabel, preferences)).join('') + '</div>' : ''}`
    )
}

function labelButton(label, counts, activeLabel, preferences) {
    const appearance = labelAppearance(label, preferences)
    const active = label.toLowerCase() === activeLabel.toLowerCase()
    const count = counts.get(label.toLowerCase()) ?? 0
    const badge = count ? `<small title="${count} conversations">${formatSidebarCount(count)}</small>` : ''
    return (
        `<button type="button" class="label-filter${active ? ' active' : ''}" data-label="${escapeHtml(label)}" aria-pressed="${
            active
        }">
    ${spriteIcon('label', `class="label-icon" style="color:${ICON_COLORS[appearance.name]}"`)}
    <span>${escapeHtml(label)}</span>${badge}</button>`
    )
}
