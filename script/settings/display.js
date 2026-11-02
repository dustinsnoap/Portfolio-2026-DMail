(() => {
    const fonts = Object.freeze({
        default: { name: 'Default (Arial)', family: 'Arial, Helvetica, sans-serif' },
        system: { name: 'System', family: 'system-ui, sans-serif' },
        georgia: { name: 'Georgia', family: 'Georgia, serif' },
        inter: { name: 'Inter', family: '"Dmail Inter", Arial, sans-serif', face: 'Dmail Inter', file: 'inter.woff2' },
        roboto: { name: 'Roboto', family: '"Dmail Roboto", Arial, sans-serif', face: 'Dmail Roboto', file: 'roboto.woff2' },
        lora: { name: 'Lora', family: '"Dmail Lora", Georgia, serif', face: 'Dmail Lora', file: 'lora.woff2' },
    })
    const defaults = Object.freeze({ primary: '', accent: '', font: 'default', size: 14, density: 'default',
        preview: true, lineSpacing: 'normal', motion: 'system' })

    function normalizeColor(value) {
        return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : ''
    }

    function choice(value, choices, fallback) {
        return choices.includes(value) ? value : fallback
    }

    function normalize(value) {
        const saved = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
        return {
            primary: normalizeColor(saved.primary), accent: normalizeColor(saved.accent),
            font: choice(saved.font, Object.keys(fonts), defaults.font),
            size: choice(saved.size, [12, 14, 16, 18], defaults.size),
            density: choice(saved.density, ['compact', 'default', 'roomy'], defaults.density),
            preview: typeof saved.preview === 'boolean' ? saved.preview : defaults.preview,
            lineSpacing: choice(saved.lineSpacing, ['normal', 'relaxed'], defaults.lineSpacing),
            motion: choice(saved.motion, ['system', 'full', 'reduced'], defaults.motion),
        }
    }

    // Contrast calculations use linear-light sRGB, not the stored channel values.
    function linearChannel(channel) {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }

    function luminance(color) {
        const channels = color.slice(1).match(/../g).map(value => linearChannel(parseInt(value, 16)))
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }

    function textColor(background) {
        return luminance(background) > 0.179 ? '#000000' : '#ffffff'
    }

    function contrast(foreground, background) {
        const first = luminance(foreground)
        const second = luminance(background)
        return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
    }

    function readableColor(color, background) {
        if (contrast(color, background) >= 4.5) { return color }
        const target = textColor(background) === '#000000' ? 0 : 255
        const channels = color.slice(1).match(/../g).map(value => parseInt(value, 16))
        for (let step = 1; step <= 20; step++) {
            const mixed = '#' + channels.map(channel => Math.round(channel + (target - channel) * step / 20)
                .toString(16).padStart(2, '0')).join('')
            if (contrast(mixed, background) >= 4.5) { return mixed }
        }
        return textColor(background)
    }

    globalThis.DmailDisplay = Object.freeze({ fonts, defaults, normalize, textColor, contrast, readableColor })
})()
