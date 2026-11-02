import { spriteIcon } from '../app/icons.js'
import { escapeHtml } from './content.js'

const EMOJIS = [
    ['😀', 'Grinning face'],
    ['😊', 'Smiling face'],
    ['😂', 'Laughing face'],
    ['❤️', 'Heart'],
    ['👍', 'Thumbs up'],
    ['👏', 'Clapping hands'],
    ['🎉', 'Celebration'],
    ['✨', 'Sparkles'],
    ['👋', 'Wave'],
    ['🙏', 'Thanks'],
    ['💡', 'Idea'],
    ['🚀', 'Rocket'],
    ['✅', 'Check mark'],
    ['📅', 'Calendar'],
    ['☕', 'Coffee'],
    ['💻', 'Laptop'],
]
export const TEMPLATES = {
    introduction: 'Hi,\n\nI enjoyed looking through your portfolio. I would love to learn more about your work and experience.\n\nBest,\n',
    project:
        'Hi,\n\nI have a project in mind and would love to discuss working together.\n\nProject' +
        ' overview:\nTimeline:\n\nLet me know if you are interested.\n\nThanks,\n',
    meeting:
        'Hi,\n\nThanks for sharing your work. Would you be available for a quick conversation this week?\n\nA few times that work for me:\n\nBest,\n',
    thanks: 'Hi,\n\nThank you for sharing this. I appreciate your time and enjoyed learning more about your work.\n\nBest,\n',
}

function tool(label, action, icon, extra = '') {
    const image = ['attach', 'link', 'emoji', 'photo', 'write', 'trash', 'microphone', 'cleanup', 'undo'].includes(icon)
        ? spriteIcon(icon) : icon
    return `<button type="button" class="editor-tool" data-action="${action}" aria-label="${label}" title="${label}" ${extra}>${image}</button>`
}

export function buildEditor(label = 'Message', { placeholder = 'Write your message…', discardLabel = 'Discard draft' } = {}) {
    return (
        `
        <div class="message-editor">
            <div class="editor-body rich-content" contenteditable="true" role="textbox"` +
        ` aria-multiline="true" aria-label="${escapeHtml(label)}" data-placeholder="${escapeHtml(placeholder)}" spellcheck="true"></div>
            <p class="editor-status" role="status" aria-live="polite" aria-atomic="true"></p>
            <div class="editor-attachments" aria-label="Attachments"></div>
            <input class="attachment-picker" type="file" multiple aria-label="Choose attachments" hidden>
            <div class="editor-format" role="group" aria-label="Text formatting" hidden>
                <select aria-label="Font" data-command="fontName">
                    <option value="Arial">Sans Serif</option><option value="Georgia">Serif</option>
                    <option value="Verdana">Verdana</option><option value="Courier New">Monospace</option>
                </select>
                <label class="editor-select" title="Text size">
                    <span class="editor-size-icon" aria-hidden="true">T<span>t</span></span>
                    <select aria-label="Text size" data-command="fontSize">
                        <option value="1">Small</option><option value="2" selected>Normal</option>
                        <option value="4">Large</option><option value="6">Huge</option>
                    </select>
                </label>
                ${tool('Bold', 'bold', '<b>B</b>', 'aria-pressed="false"')}
                ${tool('Italic', 'italic', '<i>I</i>', 'aria-pressed="false"')}
                ${tool('Underline', 'underline', '<u>U</u>', 'aria-pressed="false"')}
                <label class="editor-color" title="Text color">A<input type="color" aria-label="Text` +
        ` color" value="#202124" data-command="foreColor"></label>
                <label class="editor-select" title="Text alignment">
                    <span class="editor-alignment-icon" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
                    <select aria-label="Text alignment" data-command="alignment">
                        <option value="justifyLeft">Left</option>` +
        `<option value="justifyCenter">Center</option><option value="justifyRight">Right</option>
                    </select>
                </label>
                ${tool('Numbered list', 'insertOrderedList', '1≡')}
                ${tool('Bulleted list', 'insertUnorderedList', '•≡')}
                ${tool('Decrease indent', 'outdent', '⇤')}
                ${tool('Increase indent', 'indent', '⇥')}
                ${tool('Quote', 'quote', '❞')}
                ${tool('Strikethrough', 'strikeThrough', '<s>S</s>', 'aria-pressed="false"')}
                ${tool('Remove formatting', 'removeFormat', 'T̸')}
            </div>
            <div class="editor-panel" hidden></div>
            <div class="editor-toolbar" role="group" aria-label="Message actions">
                <button class="editor-send" type="submit" disabled>Send</button>
                ${tool('Formatting options', 'format', 'Aa', 'aria-expanded="false" aria-pressed="false"')}
                ${tool('Help me write', 'write', 'write', 'aria-expanded="false"')}
                ${tool('Attach files (50 MB total)', 'attach', 'attach')}
                ${tool('Insert link', 'link', 'link', 'aria-expanded="false"')}
                ${tool('Insert emoji', 'emoji', 'emoji', 'aria-expanded="false"')}
                ${tool('Insert photo', 'photo', 'photo', 'aria-expanded="false"')}
                ${tool('Start dictation', 'dictate', 'microphone', 'aria-pressed="false"')}
                <span class="editor-cleanup-tools">
                    ${tool('Clean up', 'clean-draft', 'cleanup')}
                    ${tool('Undo cleanup', 'undo-cleanup', 'undo', 'hidden')}
                </span>
                <span class="editor-spacer"></span>
                ${tool(escapeHtml(discardLabel), 'discard', 'trash')}
            </div>
            <p class="cleanup-disclosure">AI cleanup is available on the live portfolio.</p>
        </div>`
    )
}

export function linkPanel(selected) {
    return (
        `<h2>Insert link</h2><label>Text to display<input name="link-text" value="${escapeHtml(
            selected,
        )}"></label><label>Web or email address<input name="link-url" placeholder="https://example.com"` +
        ' type="text"></label><p class="panel-status" role="alert"></p><div class="panel-actions">' +
        '<button type="button" data-action="apply-link">Insert</button><button type="button" data-action="close-panel">Cancel</button></div>'
    )
}

export function emojiPanel() {
    return `<h2>Emoji</h2><div class="emoji-grid">${EMOJIS.map(
        ([emoji, label]) => `<button type="button" data-action="insert-emoji" data-emoji="${emoji}" aria-label="${label}">${emoji}</button>`,
    ).join('')}</div><button type="button" data-action="close-panel">Close</button>`
}

export function photoPanel() {
    return (
        '<h2>Insert photo</h2><p>PNG, JPEG, GIF, or WebP. Up to three photos, each under 500 KB.</p>' +
        '<label>Photo description<input name="photo-alt" placeholder="Describe your photo"></label>' +
        '<label class="photo-picker">Choose photo<input type="file" aria-label="Choose photo"' +
        ' accept="image/png,image/jpeg,image/gif,image/webp"></label>' +
        '<button type="button" data-action="close-panel">Cancel</button>'
    )
}

export function writePanel() {
    return (
        '<h2>Help me write</h2>' +
        '<p>Choose a local template, then personalize it. Your current message stays in place.</p>' +
        '<select aria-label="Writing template"><option value="introduction">Introduction</option>' +
        '<option value="project">Project inquiry</option><option value="meeting">Arrange a meeting</option>' +
        '<option value="thanks">Thank you</option></select><textarea aria-label="Template preview"></textarea>' +
        '<div class="panel-actions">' +
        '<button type="button" data-action="insert-template">Insert template</button>' +
        '<button type="button" data-action="close-panel">Cancel</button></div>'
    )
}
