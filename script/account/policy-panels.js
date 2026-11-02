const POLICIES = {
    privacy: { title: 'Demo privacy', content: `<p>This standalone demo stores settings, messages, and attachments in this browser.
        It does not send messages, collect analytics, create accounts, or contact the live backend.</p>
        <p>Reset the mailbox in Settings to clear local conversations. Browser storage controls can remove all demo data.</p>
        <p>The <a href="https://dustinsnoap.com/">live portfolio</a> has its own account and privacy information.</p>` },
    terms: { title: 'About this demo', content: `<p>These conversations and the resume page are sample content.
        Norris’s message is a prewritten example. Compose and Reply save locally without delivering anything.</p>
        <p>Accounts, delivery, and generated Norris replies are available on the
        <a href="https://dustinsnoap.com/">live portfolio</a> through a private backend.</p>` },
}

// Create native popup panels that share the existing information panel's placement and keyboard behavior.
export function initPolicyPanels() {
    for (const [key, policy] of Object.entries(POLICIES)) {
        const panel = document.createElement('section')
        panel.id = `${key}-panel`
        panel.className = 'about-panel policy-panel'
        panel.setAttribute('popover', 'auto')
        panel.setAttribute('role', 'dialog')
        panel.setAttribute('aria-labelledby', `${key}-title`)
        panel.innerHTML = `<header class="about-header"><div><h2 id="${key}-title">${policy.title}</h2>
            <p class="policy-date">Standalone browser demo</p></div>
            <button type="button" popovertarget="${key}-panel" popovertargetaction="hide" aria-label="Close ${policy.title}"
                autofocus>×</button></header>${policy.content}`
        document.body.append(panel)
    }
}
