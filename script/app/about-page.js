// Keep the public About page out of mailbox counts and delivery progress.
export function initAboutPage(mail, pane) {
    const markup = mail.dataset.publicPage === 'about' ? mail.innerHTML : ''
    function isOpen() {
        return pane.isOpen() && mail.dataset.publicPage === 'about'
    }
    function show() {
        if (!markup) { return false }
        mail.innerHTML = markup
        delete mail.dataset.threadId
        mail.dataset.publicPage = 'about'
        pane.show()
        mail.querySelector('.back').focus({ preventScroll: true })
        return true
    }
    return { isOpen, show }
}
