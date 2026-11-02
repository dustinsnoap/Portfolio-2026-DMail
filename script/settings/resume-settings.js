import { initGeneralLinks, initGeneralPreferences } from './general-preferences.js'

// Keep résumé preferences independent of mailbox and editor modules.
initGeneralPreferences()
initGeneralLinks()

function collectResumeMetrics() {
    import('../metrics/telemetry.js').then(module => module.initTelemetry()).catch(() => {})
}
if ('requestIdleCallback' in window) { requestIdleCallback(collectResumeMetrics, { timeout: 3000 }) } else { setTimeout(collectResumeMetrics, 0) }
