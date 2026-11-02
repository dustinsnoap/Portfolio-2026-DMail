export function keyboardAction(event, enabled = true) {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) { return '' }
    if (event.target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) { return '' }
    if (event.shiftKey && event.key !== '?') { return '' }
    if (!enabled && !['Enter', 'Escape'].includes(event.key)) { return '' }
    return { j: 'next', k: 'previous', c: 'compose', r: 'reply', s: 'star', x: 'select', '/': 'search',
        Enter: 'open', Escape: 'back', '?': 'help' }[event.key] ?? ''
}

export function isSendShortcut(event, enabled) {
    return enabled && !event.defaultPrevented && !event.isComposing && !event.altKey && !event.shiftKey &&
        event.key === 'Enter' && Boolean(event.ctrlKey || event.metaKey)
}
