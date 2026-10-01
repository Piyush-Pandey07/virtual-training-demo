/**
 * Signed 16-bit PCM, as every speaking route returns it, into the float samples Web
 * Audio plays.
 *
 * One function for the trainer's speech and the voice samples alike, so the two cannot
 * drift: a sample that decoded differently from the session would misrepresent the very
 * voice it exists to let somebody hear.
 *
 * A trailing odd byte is dropped rather than read, since half a sample is not a sample.
 */
export function pcmToFloat(pcm: ArrayBuffer): Float32Array<ArrayBuffer> {
  const samples = new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 2));
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = samples[i]! / 0x8000;
  }
  return out;
}
