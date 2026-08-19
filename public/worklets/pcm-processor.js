/**
 * Microphone capture worklet.
 *
 * Runs on the audio thread, batches incoming frames into chunks large enough to
 * be worth sending over a socket, converts them from float to signed 16-bit PCM,
 * and posts them to the main thread along with a loudness reading.
 *
 * The AudioContext that hosts this worklet is created at the capture sample rate,
 * so the browser has already resampled the microphone for us and no resampling is
 * needed here.
 */

/** Samples per posted chunk. At 16 kHz this is 64 ms, a good balance of latency and overhead. */
const CHUNK_SAMPLES = 1024;

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(CHUNK_SAMPLES);
    this._offset = 0;
    this._muted = false;

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'mute') {
        this._muted = Boolean(event.data.value);
      }
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // No input yet, or the track has ended. Keep the node alive either way.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      this._buffer[this._offset] = channel[i];
      this._offset += 1;

      if (this._offset < CHUNK_SAMPLES) continue;

      // Convert to 16-bit PCM and measure loudness in the same pass.
      const pcm = new Int16Array(CHUNK_SAMPLES);
      let sumOfSquares = 0;
      for (let j = 0; j < CHUNK_SAMPLES; j += 1) {
        const sample = Math.max(-1, Math.min(1, this._buffer[j]));
        sumOfSquares += sample * sample;
        pcm[j] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      const rms = Math.sqrt(sumOfSquares / CHUNK_SAMPLES);

      this.port.postMessage(
        { type: 'pcm', payload: pcm.buffer, rms, muted: this._muted },
        [pcm.buffer],
      );
      this._offset = 0;
    }

    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
