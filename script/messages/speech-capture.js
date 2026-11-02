// Release microphone tracks before waiting for the final audio chunk to flush.
export async function captureSpeech(signal, onLimit = () => {}) {
    signal.throwIfAborted()
    const stream = await requestMicrophone(signal)
    let context
    let source
    let processor
    let limited = false
    let stopped = false
    let ended = false
    let failure = null
    let received = 0
    let peak = 0
    let wake = null
    const queue = []
    const stopTracks = () => stream.getTracks().forEach(track => track.stop())

    function release() {
        source?.disconnect()
        processor?.disconnect()
        context?.close().catch(() => {})
        signal.removeEventListener('abort', cancel)
    }

    function finish(error = null) {
        if (ended) { return }
        ended = true
        failure = error
        stopTracks()
        release()
        wake?.()
    }

    function cancel() {
        queue.length = 0
        finish(signal.reason)
    }

    signal.addEventListener('abort', cancel, { once: true })
    try {
        signal.throwIfAborted()
        context = new AudioContext()
        await context.resume()
        await context.audioWorklet.addModule(new URL('./speech-worklet.js', import.meta.url))
        signal.throwIfAborted()
        source = context.createMediaStreamSource(stream)
        processor = new AudioWorkletNode(context, 'dmail-dictation')
        processor.port.onmessage = ({ data }) => {
            if (ended) { return }
            if (data.done) { finish(); return }
            received += data.samples.length
            for (const value of data.samples) { peak = Math.max(peak, Math.abs(value)) }
            queue.push(data.samples)
            // Cap queued audio at 30 seconds (~2 MB), then drain it rather than dropping samples.
            if (queue.length >= 120 && !stopped) { limited = true; stop(); onLimit() }
            wake?.()
        }
        processor.onprocessorerror = () => finish(new Error('Microphone processing stopped unexpectedly.'))
        for (const track of stream.getTracks()) {
            track.addEventListener('ended', () => finish(new Error('The microphone was disconnected.')), { once: true })
        }
        source.connect(processor)
        processor.connect(context.destination)
    } catch (error) {
        finish(error)
        throw error
    }

    async function* chunks() {
        while (true) {
            signal.throwIfAborted()
            if (failure) { throw failure }
            if (queue.length) { yield queue.shift(); continue }
            if (ended) { return }
            await new Promise(resolve => { wake = resolve })
            wake = null
        }
    }

    function stop() {
        if (stopped || ended) { return }
        stopped = true
        stopTracks()
        processor.port.postMessage('stop')
        // A suspended audio context may never answer its port, so bound teardown time.
        const timeout = setTimeout(() => finish(), 1000)
        const previous = wake
        wake = () => { clearTimeout(timeout); previous?.() }
    }

    return { chunks: chunks(), stop,
        get pending() { return queue.length },
        get signal() { return { received, peak } },
        get limited() { return limited },
    }
}

// Permission prompts cannot be cancelled programmatically; release tracks from any late grant.
function requestMicrophone(signal) {
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        navigator.mediaDevices.getUserMedia({ audio: {
            channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true,
        } }).then(stream => {
            signal.removeEventListener('abort', abort)
            if (signal.aborted) { stream.getTracks().forEach(track => track.stop()) } else { resolve(stream) }
        }, error => {
            signal.removeEventListener('abort', abort)
            reject(error)
        })
    })
}
