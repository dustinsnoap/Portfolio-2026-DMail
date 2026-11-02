import { CHATBOT_NAME, OWNER_NAME } from '../app/identity.js'

const assets = '/api/portfolio/assets/speech/'
export const DICTATION_KEYWORDS = Object.freeze([...new Set([
    OWNER_NAME, OWNER_NAME.split(' ')[0], CHATBOT_NAME, 'DMail', 'JavaScript', 'DynamoDB', 'CloudFront',
    'AWS', 'Tebra', 'Zappos', 'PhotoSeeb', 'Reasonably Adequate Photo Studio',
])])
const modelHash = 'b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb'

export function createSpeechSession(signal, onProgress) {
    signal.throwIfAborted()
    const worker = new Worker(assets + 'worker.js?v=0.3.0', { type: 'module', name: 'dmail-dictation' })
    let pending = null
    let closed = false
    let sequence = 0
    let readyResolve
    let readyReject
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
    const timeout = setTimeout(() => close(new Error('Speech loading timed out. Please try again.')), 120000)

    function close(error = new DOMException('Dictation stopped', 'AbortError')) {
        if (closed) { return }
        closed = true
        clearTimeout(timeout)
        signal.removeEventListener('abort', abort)
        worker.terminate()
        readyReject(error)
        pending?.reject(error)
        pending = null
    }

    function abort() { close(signal.reason) }

    worker.onmessage = ({ data }) => {
        if (closed) { return }
        if (data.type === 'progress') { onProgress(data.progress.percentage ?? 0); return }
        if (data.type === 'ready') { clearTimeout(timeout); readyResolve(); return }
        if (data.type === 'error') { close(new Error(data.message || 'Speech recognition failed.')); return }
        if (data.type === 'result' && data.id === pending?.id) {
            const request = pending
            pending = null
            request.resolve(data.value)
        }
    }
    worker.onerror = event => {
        event.preventDefault()
        close(new Error('Could not start speech recognition in this browser.'))
    }
    worker.onmessageerror = () => close(new Error('Could not read the speech recognition result.'))
    signal.addEventListener('abort', abort, { once: true })
    // Use cactus-needle 0.3.0's worker protocol; its text/AI SDK uses a different message format.
    worker.postMessage({ type: 'init', config: {
        modelKind: 'whistle', model: location.origin + assets + 'whistle.cact',
        modelSha256: modelHash, modelSize: 16919407, wasmUrl: location.origin + assets + 'needle.wasm',
        cache: true, offline: false, system: '', toolsJson: '[]', stateless: true, bufferSize: 262144,
    } })

    async function request(method, samples) {
        await ready
        signal.throwIfAborted()
        if (closed || pending) { throw new Error('The dictation session is unavailable.') }
        return new Promise((resolve, reject) => {
            pending = { id: ++sequence, resolve, reject }
            worker.postMessage({ id: sequence, method, audio: samples,
                settings: { language: 'en', keywords: DICTATION_KEYWORDS } }, samples ? [samples.buffer] : [])
        })
    }

    return { ready, close, process: samples => request('streamTranscribe', samples),
        transcribe: samples => request('transcribe', samples) }
}
