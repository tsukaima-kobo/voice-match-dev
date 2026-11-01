// WAV の読み書き（tools/ 用）。PCM 16/24/32 ビットと 32 ビット浮動小数。2 チャンネル以上は平均して 1 つに。
export function readWav(buf: Uint8Array): { rate: number; samples: Float32Array } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('WAV ではありません');
  let o = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (o + 8 <= buf.length) {
    const id = tag(o),
      size = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = dv.getUint16(body, true);
      // (WAVE_FORMAT_EXTENSIBLE: the real format is in the sub-format GUID's first two bytes)
      if (format === 0xfffe) format = dv.getUint16(body + 24, true);
      fmt = { format, channels: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('fmt が data より後にあります');
      const { format, channels, rate, bits } = fmt;
      const bytes = bits / 8;
      const frames = Math.floor(Math.min(size, buf.length - body) / (bytes * channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * bytes;
          if (format === 3 && bits === 32) s += dv.getFloat32(p, true);
          else if (format === 1 && bits === 16) s += dv.getInt16(p, true) / 32768;
          else if (format === 1 && bits === 24) s += ((buf[p]! | (buf[p + 1]! << 8) | (buf[p + 2]! << 16)) << 8 >> 8) / 8388608;
          else if (format === 1 && bits === 32) s += dv.getInt32(p, true) / 2147483648;
          else throw new Error(`この WAV の形（format ${format}, ${bits} ビット）は読めません`);
        }
        out[i] = s / channels;
      }
      return { rate, samples: out };
    }
    o = body + size + (size & 1);
  }
  throw new Error('WAV に音がありません');
}

/** 16 ビット PCM・1 チャンネルの WAV */
export function writeWav(samples: ArrayLike<number>, rate: number): Uint8Array {
  const n = samples.length;
  const buf = new Uint8Array(44 + n * 2);
  const dv = new DataView(buf.buffer);
  const put = (o: number, s: string) => [...s].forEach((ch, i) => (buf[o + i] = ch.charCodeAt(0)));
  put(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  put(36, 'data');
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), true);
  return buf;
}
