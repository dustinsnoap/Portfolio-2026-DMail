const sampleRate = 16000
const quietLimit = sampleRate * 1.25
const phraseLimit = sampleRate * 20

function combine(chunks) {
    const samples = new Float32Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length }
    return samples
}

function hasVoice(samples) {
    let energy = 0
    for (const value of samples) { energy += value * value }
    return energy / samples.length > .004 ** 2
}

export function createPhraseRecognizer(speech, onCadence = () => {}) {
    let chunks = []
    let queued = []
    let size = 0
    let queuedSize = 0
    let quiet = 0
    let leading = null
    let streamed = false
    let agreed = ''
    let previewInterval = 1

    async function finish() {
        if (!size) { return null }
        // Streaming words are provisional; reset them before the next complete phrase.
        if (streamed) { await speech.process() }
        const result = await speech.transcribe(combine(chunks))
        chunks = []
        queued = []
        size = 0
        queuedSize = 0
        quiet = 0
        streamed = false
        agreed = ''
        return { text: result.text, pending: '' }
    }

    async function process(samples, allowPreview = true) {
        if (!(samples instanceof Float32Array) || !samples.length || samples.length > sampleRate) {
            throw new TypeError('Dictation expects at most one second of 16 kHz mono samples.')
        }
        const voice = hasVoice(samples)
        if (!size && !voice) { leading = samples; return null }
        if (!size && leading) {
            chunks.push(leading)
            queued.push(leading)
            size = leading.length
            queuedSize = size
            leading = null
        }
        chunks.push(samples)
        queued.push(samples)
        size += samples.length
        queuedSize += samples.length
        quiet = voice ? 0 : quiet + samples.length
        if (quiet >= quietLimit || size >= phraseLimit) { return finish() }
        if (!allowPreview || queuedSize < sampleRate * previewInterval) { return null }
        // The worker takes ownership of this buffer; keep the original phrase samples for final transcription.
        const started = performance.now()
        const part = await speech.process(combine(queued))
        // Back off preview cadence when inference cannot keep up with the microphone.
        const interval = Math.max(1, Math.min(3, Math.ceil((performance.now() - started) / 500)))
        if (interval !== previewInterval) { previewInterval = interval; onCadence(interval) }
        streamed = true
        queued = []
        queuedSize = 0
        if (part.text) { agreed = [agreed, part.text].filter(Boolean).join(' ') }
        return { text: '', pending: [agreed, part.pending].filter(Boolean).join(' ') }
    }

    return { process, finish }
}
