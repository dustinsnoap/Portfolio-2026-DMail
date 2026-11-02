import { AVATAR_KEY, notifyAccountChange } from './account-storage.js'

// Redraw uploads to discard file metadata and limit avatar storage.
export async function prepareAvatar(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5000000) {
        throw new Error('Choose a PNG, JPEG, or WebP image under 5 MB.')
    }
    const bitmap = await createImageBitmap(file, { resizeWidth: 256, resizeQuality: 'high' })
    try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 128
        const size = Math.min(bitmap.width, bitmap.height)
        canvas.getContext('2d').drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 128, 128)
        const avatar = canvas.toDataURL('image/webp', 0.82)
        if (avatar.length > 32000) { throw new Error('This image is too detailed. Please choose a smaller image.') }
        return avatar
    } finally { bitmap.close() }
}

// Map legacy owner-photo URLs to the small portrait; leave visitor images unchanged.
export function portfolioAvatar(source) {
    const value = typeof source === 'string' ? source.replace(/^(?:\/|\.\/)?img\//, '/api/portfolio/assets/img/') : source
    return ['/api/portfolio/assets/img/me.jpg', '/api/portfolio/assets/img/me-avatar.webp'].includes(value)
        ? '/api/portfolio/assets/img/me-avatar.webp' : value
}

export function avatarPresentation(session, avatar = '') {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatar) || avatar.length > 32000) { avatar = '' }
    return { image: avatar || (!session?.signedIn ? portfolioAvatar('/api/portfolio/assets/img/me.jpg') : ''),
        initial: (session?.name?.trim()[0] || 'U').toUpperCase() }
}

export function renderAvatar(session, scope = document) {
    let avatar = ''
    try { avatar = localStorage.getItem(AVATAR_KEY) || '' } catch { }
    const presentation = avatarPresentation(session, avatar)
    for (const container of scope.querySelectorAll('[data-account-avatar]')) {
        container.replaceChildren()
        if (presentation.image) {
            const image = document.createElement('img')
            image.src = presentation.image
            image.alt = ''
            container.append(image)
        } else { container.textContent = presentation.initial }
    }
}

export function saveAvatar(avatar, session) {
    if (!session?.signedIn) { throw new Error('Sign in to change your avatar.') }
    if (avatar) { localStorage.setItem(AVATAR_KEY, avatar) } else { localStorage.removeItem(AVATAR_KEY) }
    renderAvatar(session)
    notifyAccountChange()
}
