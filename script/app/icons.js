export function spriteIcon(name, attributes = '') {
    return `<svg ${attributes} aria-hidden="true"><use href="/api/portfolio/assets/img/sprites.svg?v=b735be376c5e#icon-${name}" /></svg>`
}
