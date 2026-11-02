export function createMailboxRefresh({ refresh, render }) {
    const list = document.querySelector('.email-list')
    const button = document.querySelector('.top-bar .refresh')
    let running = false
    let animation = null

    // A cancelled animation must not leave the list transparent.
    async function fade(from, to, duration) {
        animation = list.animate([{ opacity: from }, { opacity: to }], { duration, easing: 'ease-out', fill: 'forwards' })
        await animation.finished
    }

    async function run() {
        if (running) { return }
        running = true
        button.disabled = true
        list.setAttribute('aria-busy', 'true')
        const motion = document.documentElement.dataset.motion !== 'reduced'
        try {
            if (motion) { await fade(1, 0, 90) }
            refresh()
            render()
            animation?.cancel()
            if (motion) { await fade(0, 1, 180) }
        } catch (error) {
            render(`Mailbox could not be refreshed. ${error.message}`)
        } finally {
            animation?.cancel()
            animation = null
            list.removeAttribute('aria-busy')
            button.disabled = false
            running = false
        }
    }

    return run
}
