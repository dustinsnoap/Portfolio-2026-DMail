// Keep the device context's native rate; the speech model still requires resampling to 16 kHz.
class DictationCapture extends AudioWorkletProcessor {
    constructor() {
        super()
        this.ratio = sampleRate / 16000
        this.kernels = sampleRate === 16000 ? null : resamplingKernels(sampleRate)
        this.history = new Float32Array(64)
        this.inputIndex = 0
        this.outputIndex = 0
        this.samples = new Float32Array(4000)
        this.length = 0
        this.running = true
        this.port.onmessage = () => {
            this.running = false
            if (this.length) { this.emit() }
            this.port.postMessage({ done: true })
        }
    }

    emit() {
        const samples = this.samples.slice(0, this.length)
        this.port.postMessage({ samples }, [samples.buffer])
        this.length = 0
    }

    write(value) {
        this.samples[this.length++] = Math.max(-1, Math.min(1, value))
        if (this.length === this.samples.length) { this.emit() }
    }

    resample(value) {
        this.history[this.inputIndex % 64] = value
        while (this.outputIndex * this.ratio <= this.inputIndex) {
            const fraction = this.inputIndex - this.outputIndex * this.ratio
            const kernel = this.kernels[Math.min(127, Math.round(fraction * 128))]
            let filtered = 0
            for (let tap = 0; tap < 64; tap++) {
                filtered += this.history[(this.inputIndex - tap + 64) % 64] * kernel[tap]
            }
            this.write(filtered)
            this.outputIndex++
        }
        this.inputIndex++
    }

    process(inputs) {
        if (!this.running) { return false }
        const channels = inputs[0]
        if (!channels?.length) { return true }
        for (let frame = 0; frame < channels[0].length; frame++) {
            let value = 0
            for (const channel of channels) { value += channel[frame] }
            const mono = value / channels.length
            const bounded = Number.isFinite(mono) ? Math.max(-1, Math.min(1, mono)) : 0
            if (this.kernels) { this.resample(bounded) } else { this.write(bounded) }
        }
        return true
    }
}

// Low-pass before downsampling to prevent high frequencies aliasing into speech.
function resamplingKernels(rate) {
    const cutoff = .45 * Math.min(1, 16000 / rate)
    return Array.from({ length: 128 }, (_, phase) => {
        const kernel = new Float32Array(64)
        let total = 0
        for (let tap = 0; tap < kernel.length; tap++) {
            const distance = tap - 31.5 - phase / 128
            const angle = 2 * Math.PI * cutoff * distance
            const sinc = angle === 0 ? 1 : Math.sin(angle) / angle
            kernel[tap] = sinc * (.54 - .46 * Math.cos(2 * Math.PI * tap / 63))
            total += kernel[tap]
        }
        return kernel.map(value => value / total)
    })
}

registerProcessor('dmail-dictation', DictationCapture)
