import { escapeHtml } from '../messages/content.js'
import { apiRequest, messagingConfigured } from '../storage/portfolio-api.js'

const countDefinitions = [
    ['pageLoads', 'Page loads', 'Loaded documents reported by participating browsers; not unique people.'],
    ['projectOpens', 'Project opens', 'A public project opened once per loaded page.'],
    ['writingOpens', 'Writing opens', 'A public article opened once per loaded page.'],
    ['updateOpens', 'Update opens', 'A public update conversation opened once per loaded page.'],
    ['resumeDownloads', 'Résumé download clicks', 'Download intent; not confirmation that a file was saved.'],
    ['messagesAccepted', 'Messages accepted', 'New visitor messages successfully saved by the server, excluding imports and retries.'],
    ['aiReferrals', 'AI referrals', 'Loads with a recognized AI-site referrer. Referrer-free visits cannot be attributed.'],
    ['searchReferrals', 'Search referrals', 'Loads with a recognized search-engine referrer.'],
]
const timingDefinitions = [
    ['mailboxReady', 'Mailbox ready · p75', 'Time from document navigation to the first rendered mailbox list.', 'p75'],
    ['ttfb', 'First byte · p75', 'Time from navigation until the first response byte reaches the browser.', 'p75'],
    ['lcp', 'Largest contentful paint · p75', 'Browser LCP samples finalized when the page first becomes hidden.', 'p75'],
    ['cls', 'Layout shift · p75', 'Largest browser CLS session window, reported when the page first becomes hidden.', 'p75'],
    ['apiLatency', 'API response time · p95', 'Server processing through response writing, excluding health and metrics requests.', 'p95'],
]

const numberFormat = new Intl.NumberFormat()

function card(title, value, definition, detail = '') {
    return `<article class="metric-card"><h3>${escapeHtml(title)}</h3><strong>${escapeHtml(value)}</strong>
        <p>${escapeHtml(definition)}</p>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</article>`
}

// Histogram percentiles are estimates; missing browser measurements remain unknown.
function timingCard(name, title, definition, percentile, report) {
    const metric = report.timings[name]
    const sample = metric?.[percentile]
    const value = sample == null ? 'Not enough data' : name === 'cls' ? `≤ ${(sample / 1000).toFixed(3)}` : `≤ ${sample} ms`
    return card(title, value, definition, `${metric?.samples ?? 0} samples; percentiles use fixed histogram buckets.`)
}

function reportMarkup(report) {
    const counts = report.counts
    const number = value => numberFormat.format(value ?? 0)
    const cards = countDefinitions.map(([name, title, definition]) => card(title, number(counts[name]), definition))
    cards.push(...timingDefinitions.map(values => timingCard(...values, report)))
    const requests = counts.apiRequests ?? 0
    cards.push(card('API success rate', requests ? `${((counts.apiSuccesses ?? 0) / requests * 100).toFixed(1)}%` : 'Not enough data',
        'Successful API responses; authentication, validation and server errors are included in the denominator.',
        `${number(requests)} requests; ${number(counts.apiServerErrors)} server errors; ${number(counts.apiClientErrors)} client errors.`))
    const rows = report.daily.map(day => `<tr><th scope="row">${escapeHtml(day.date)}</th>
        <td>${number(day.counts.pageLoads)}</td><td>${number((day.counts.projectOpens ?? 0) + (day.counts.writingOpens ?? 0) +
            (day.counts.updateOpens ?? 0))}</td><td>${number(day.counts.apiRequests)}</td></tr>`).join('')
    return `<p>UTC dates: ${escapeHtml(report.since)} through ${escapeHtml(report.until)}.
        ${report.updatedAt ? `Last saved ${escapeHtml(new Date(report.updatedAt).toLocaleString())}.` : 'Waiting for the first saved batch.'}</p>
        <div class="metrics-grid">${cards.join('')}</div><div class="metrics-table"><table><caption>Daily activity</caption>
        <thead><tr><th scope="col">UTC date</th><th scope="col">Page loads</th><th scope="col">Public opens</th>
        <th scope="col">API requests</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No saved observations yet.</td></tr>'}</tbody>
        </table></div>`
}

export function mountMetrics(panel) {
    if (!messagingConfigured()) {
        panel.innerHTML = '<p>The standalone demo does not collect traffic statistics. '
            + 'Explore the Metrics tab on the <a href="https://dustinsnoap.com/">live portfolio</a>.</p>'
        return
    }
    if (panel.dataset.metricsMounted) { return }
    panel.dataset.metricsMounted = 'true'
    panel.innerHTML = `<p class="settings-intro">Anonymous site-wide usage and performance. No identities, messages, search terms,
        or raw referrer URLs are collected for these statistics. Browser reporting respects Do Not Track and Global Privacy Control.</p>
        <div class="metrics-controls"><label>Time range<select data-metrics-range><option value="28">Last 28 days</option>
        <option value="7">Last 7 days</option></select></label><button type="button" data-refresh-metrics>Refresh metrics</button></div>
        <p class="metrics-status" role="status" aria-live="polite"></p><div data-metrics-report></div>
        <p>Collection starts with this release; there is no invented historical data. Totals are best-effort observations,
        not unique visitors. Aggregates are saved about every 30 seconds and may be cached for another 30 seconds.</p>
        <p>Search rankings, search impressions, and AI citations require search-provider reports and are not measured here.</p>`
    let request = 0
    async function refresh() {
        const token = ++request
        const button = panel.querySelector('[data-refresh-metrics]')
        const status = panel.querySelector('.metrics-status')
        button.disabled = true
        status.textContent = 'Loading metrics…'
        try {
            const response = await apiRequest(`/metrics?days=${panel.querySelector('[data-metrics-range]').value}`)
            const report = await response.json()
            if (!panel.isConnected || token !== request) { return }
            panel.querySelector('[data-metrics-report]').innerHTML = reportMarkup(report)
            status.textContent = ''
        } catch {
            if (panel.isConnected && token === request) { status.textContent = 'Metrics are unavailable. Try Refresh metrics again.' }
        } finally { if (token === request) { button.disabled = false } }
    }
    panel.querySelector('[data-refresh-metrics]').addEventListener('click', refresh)
    panel.querySelector('[data-metrics-range]').addEventListener('change', refresh)
    refresh()
}
