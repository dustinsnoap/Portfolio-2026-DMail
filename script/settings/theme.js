// Apply saved appearance before first paint to avoid a flash of the default theme.
(() => {
    const root = document.documentElement
    const model = globalThis.DmailDisplay
    const preferenceKey = 'dmail_preferences_v1'
    const overrideKey = 'dmail_resume_light_v1'
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
    const systemMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const loadedFonts = new Map()
    let currentFont = ''

    function readPreference(key) {
        try { return localStorage.getItem(key) } catch { return null }
    }

    function readPreferences() {
        try {
            const value = JSON.parse(readPreference(preferenceKey) || '{}')
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
        } catch { return {} }
    }

    function resolveTheme(value) {
        if (value === 'dark' || value === 'light') { return value }
        return systemTheme.matches ? 'dark' : 'light'
    }

    function setVariable(name, value) {
        if (value) { root.style.setProperty(name, value) } else { root.style.removeProperty(name) }
    }

    function applyColors(appearance) {
        const light = root.dataset.theme === 'light' || root.dataset.resumeLight === 'true'
        const surface = light ? '#ffffff' : '#2c2c2c'
        root.dataset.primary = String(Boolean(appearance.primary))
        root.dataset.accent = String(Boolean(appearance.accent))
        setVariable('--display-primary', appearance.primary)
        setVariable('--display-primary-ink', appearance.primary ? model.textColor(appearance.primary) : '')
        setVariable('--display-accent', appearance.accent)
        setVariable('--display-link', appearance.accent ? model.readableColor(appearance.accent, '#ffffff') : '')
        setVariable('--gmail-accent', appearance.accent ? model.readableColor(appearance.accent, surface) : '')
        setVariable('--gmail-button', appearance.primary)
        setVariable('--gmail-button-ink', appearance.primary ? model.textColor(appearance.primary) : '')
        setVariable('--gmail-hover', appearance.primary)
    }

    function applyLayout(appearance) {
        root.dataset.density = appearance.density
        root.dataset.preview = String(appearance.preview)
        root.dataset.motion = appearance.motion === 'system'
            ? systemMotion.matches ? 'reduced' : 'full' : appearance.motion
        setVariable('--text-scale', String(appearance.size / 14))
        setVariable('--reading-line-height', appearance.lineSpacing === 'relaxed' ? '1.8' : '1.5')
    }

    function reportFontStatus(message) {
        root.dataset.fontStatus = message
        document.dispatchEvent(new CustomEvent('dmail:font-status', { detail: message }))
    }

    // Share in-flight font requests so rapid preference changes do not download the same font twice.
    function loadFont(id) {
        if (loadedFonts.has(id)) { return loadedFonts.get(id) }
        const font = model.fonts[id]
        const face = new FontFace(font.face, `url("/api/portfolio/assets/fonts/${font.file}")`, { weight: '400 700', display: 'swap' })
        document.fonts.add(face)
        const loading = face.load().then(() => {
            if (currentFont === id) { reportFontStatus('') }
        }).catch(() => {
            document.fonts.delete(face)
            loadedFonts.delete(id)
            if (currentFont === id) {
                reportFontStatus(
                `${font.name} could not load. A system font is being used; your selection is saved.`,
                )
            }
        })
        loadedFonts.set(id, loading)
        return loading
    }

    function applyFont(appearance) {
        setVariable('--display-font', appearance.font === 'default' ? '' : model.fonts[appearance.font].family)
        if (currentFont === appearance.font) { return }
        currentFont = appearance.font
        reportFontStatus('')
        if (model.fonts[currentFont].file && typeof FontFace === 'function') { loadFont(currentFont) }
    }

    function updateThemeColor() {
        const meta = document.querySelector('meta[name="theme-color"]')
        if (meta) { meta.content = getComputedStyle(root).getPropertyValue('--gmail-canvas').trim() || '#191919' }
    }

    function updateToggle() {
        const toggle = document.querySelector('#resume-light')
        if (!toggle) { return }
        const enabled = root.dataset.resumeLight === 'true'
        toggle.setAttribute('aria-pressed', String(enabled))
        toggle.title = enabled ? 'Use Dmail theme' : 'Switch to light theme'
        toggle.hidden = root.dataset.theme === 'light'
    }

    function applyTheme() {
        const preferences = readPreferences()
        const appearance = model.normalize(preferences.appearance)
        root.dataset.theme = resolveTheme(preferences.theme)
        applyColors(appearance)
        applyLayout(appearance)
        applyFont(appearance)
        updateToggle()
        updateThemeColor()
    }

    function saveOverride(enabled) {
        try {
            if (enabled) { localStorage.setItem(overrideKey, 'true') } else { localStorage.removeItem(overrideKey) }
        } catch { }
    }

    function changeOverride() {
        const enabled = root.dataset.resumeLight !== 'true'
        root.dataset.resumeLight = String(enabled)
        applyTheme()
        saveOverride(enabled)
    }

    function connectToggle() {
        applyTheme()
        document.querySelector('#resume-light')?.addEventListener('click', changeOverride)
    }

    function syncTheme(event) {
        if (event.key === overrideKey || event.key === null) {
            if (root.hasAttribute('data-resume')) { root.dataset.resumeLight = String(readPreference(overrideKey) === 'true') }
        }
        if ([preferenceKey, overrideKey, null].includes(event.key)) { applyTheme() }
    }

    if (root.hasAttribute('data-resume')) { root.dataset.resumeLight = String(readPreference(overrideKey) === 'true') }
    applyTheme()
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', connectToggle, { once: true })
    } else { connectToggle() }
    document.addEventListener('dmail:appearance-change', applyTheme)
    window.addEventListener('storage', syncTheme)
    window.addEventListener('pageshow', applyTheme)
    systemTheme.addEventListener('change', applyTheme)
    systemMotion.addEventListener('change', applyTheme)
    window.matchMedia('(width < 800px)').addEventListener('change', updateThemeColor)
})()
