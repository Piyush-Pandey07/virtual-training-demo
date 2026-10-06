/**
 * The samples inside a WAV file, checked against what the player can use.
 *
 * Sarvam returns its speech as a WAV file. The browser builds its audio buffers straight
 * from raw 16-bit mono samples at AUDIO_SAMPLE_RATE, with no decoding step, so the file
 * is opened here and only its samples go on to the browser, exactly as Deepgram's arrive.
 *
 * The chunks are walked rather than the first 44 bytes skipped. A 44-byte header is
 * common, not guaranteed: an encoder may put a LIST chunk of metadata ahead of the data,
 * and skipping a fixed count would then play that metadata as a burst of noise. Anything
 * that is not the exact format the player expects is refused rather than played: audio at
 * the wrong rate comes out at the wrong pitch, which is worse than a clear error.
 */

function ascii(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

export function pcmFromWav(bytes: Uint8Array, sampleRate: number): Uint8Array {
  if (bytes.length < 12 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE') {
    throw new Error('The speech did not come back as a WAV file.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: { encoding: number; channels: number; rate: number; bits: number } | null = null;
  let at = 12;

  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;

    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length)
        throw new Error('The WAV format block is cut short.');
      format = {
        encoding: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!format) throw new Error('The WAV data arrived before its format.');
      // 1 is plain PCM; 0xFFFE is the extensible header some encoders write for it.
      if (format.encoding !== 1 && format.encoding !== 0xfffe) {
        throw new Error(`The speech is not plain PCM (format ${format.encoding}).`);
      }
      if (format.channels !== 1 || format.bits !== 16 || format.rate !== sampleRate) {
        throw new Error(
          `The speech came back as ${format.channels} channel, ${format.bits}-bit, ${format.rate} Hz audio; the player needs mono 16-bit at ${sampleRate} Hz.`,
        );
      }
      // A streamed WAV may not know its length when the header is written, and says so
      // with a size of zero or all ones. Either way the samples run to the end.
      const declared = size === 0 || size === 0xffffffff ? bytes.length - body : size;
      const end = Math.min(body + declared, bytes.length);
      // Whole samples only. A trailing half sample would be read as noise.
      return bytes.subarray(body, end - ((end - body) % 2));
    }

    // Chunks are padded to an even length.
    at = body + size + (size % 2);
  }

  throw new Error('The WAV file has no audio in it.');
}
