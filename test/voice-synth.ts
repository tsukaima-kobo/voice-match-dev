// Test signals for src/voice/measure.ts (test/voice-measure.test.ts): made here from numbers only, no
// recording. A seeded generator (mulberry32) for the noise and the jitter, so that every run makes the same samples.
// tone(): a sum of harmonics at a known F0 (the pitch's accuracy); vowel(): a pulse train with jitter and shimmer
// through three formant resonances, aspiration noise mixed into the source (breath), syllable bursts and pauses by an
// envelope (speed, pause); silence(), the quiet room as a little noise.

/** a seeded generator of numbers in [0, 1) (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** a normal number from the generator (Box–Muller) */
export const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());

/** the RMS of samples */
export const rmsOf = (x: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, x.length));
};
/** samples scaled to an RMS */
export function toRms(x: Float32Array, rms: number): Float32Array {
  const k = rms / Math.max(1e-12, rmsOf(x));
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * k;
  return x;
}
/** clips one after another */
export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
/** a quiet room: white noise at `rms` (0: digital silence) */
export function silence(rate: number, seconds: number, rms = 0.0003, seed = 7): Float32Array {
  const r = rng(seed);
  const x = new Float32Array(Math.round(rate * seconds));
  if (rms > 0) for (let i = 0; i < x.length; i++) x[i] = gauss(r) * rms;
  return x;
}
/** another signal added (both as they are) */
export function mixIn(x: Float32Array, y: ArrayLike<number>): Float32Array {
  for (let i = 0; i < x.length && i < y.length; i++) x[i] = x[i]! + y[i]!;
  return x;
}

export interface ToneOptions {
  rate: number;
  seconds: number;
  /** the F0 in Hz, or as a function of the time in seconds */
  f0: number | ((t: number) => number);
  /** the RMS (default 0.1, about -20 dBFS) */
  rms?: number;
  /** the harmonics' fall: amplitude 1/k^tilt (default 1) */
  tilt?: number;
  /** harmonics up to this frequency (default 5 kHz) */
  maxHz?: number;
}
/** a sum of harmonics at a known F0 (phase summed, so a changing F0 glides) */
export function tone(o: ToneOptions): Float32Array {
  const n = Math.round(o.rate * o.seconds);
  const x = new Float32Array(n);
  const f0At = typeof o.f0 === 'number' ? () => o.f0 as number : o.f0;
  const maxHz = o.maxHz ?? 5000;
  const tilt = o.tilt ?? 1;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = f0At(i / o.rate);
    phase += (2 * Math.PI * f) / o.rate;
    let v = 0;
    for (let k = 1; k * f < maxHz && k * f < o.rate / 2; k++) v += Math.sin(k * phase) / k ** tilt;
    x[i] = v;
  }
  return toRms(x, o.rms ?? 0.1);
}

export interface VowelOptions {
  rate: number;
  seconds: number;
  f0: number | ((t: number) => number);
  /** each period changed by up to ± this share (uniform) */
  jitter?: number;
  /** each pulse's amplitude changed by up to ± this share (uniform) */
  shimmer?: number;
  /** aspiration noise in the source, as its RMS over the pulses' RMS */
  breath?: number;
  /** the formants (Hz) and their bandwidths (Hz) */
  formants?: readonly (readonly [number, number])[];
  /** the loudness over time (0..1), e.g. syllables and pauses */
  envelope?: (t: number) => number;
  /** where the glottis's fall of the highs starts (Hz, default 150: a soft voice; higher, a pressed and brighter one) */
  glottis?: number;
  rms?: number;
  seed?: number;
}
/** a voiced sound: a band-limited pulse train through formant resonances, the lips' rise of the highs (a difference) */
export function vowel(o: VowelOptions): Float32Array {
  const n = Math.round(o.rate * o.seconds);
  const r = rng(o.seed ?? 1);
  const f0At = typeof o.f0 === 'number' ? () => o.f0 as number : o.f0;
  const src = new Float64Array(n);
  // (each pulse a short windowed sinc at its exact time: its timing is not rounded to a sample)
  const HALF = 6;
  let t = 0.004 * o.rate;
  while (t < n - HALF) {
    const amp = 1 + (o.shimmer ?? 0) * (2 * r() - 1);
    const i0 = Math.floor(t);
    for (let j = -HALF; j <= HALF; j++) {
      const u = i0 + j - t;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * u) / (HALF + 1));
      const s = u === 0 ? 1 : Math.sin(Math.PI * 0.9 * u) / (Math.PI * 0.9 * u);
      const i = i0 + j;
      if (i >= 0 && i < n) src[i] = src[i]! + amp * 0.9 * s * w;
    }
    const T = o.rate / f0At(t / o.rate);
    t += T * (1 + (o.jitter ?? 0) * (2 * r() - 1));
  }
  // (the glottis's fall of the highs: two one-pole low-passes at 150 Hz, -12 dB an octave above; the lips give +6 back)
  for (let pass = 0; pass < 2; pass++) {
    const k = Math.exp((-2 * Math.PI * (o.glottis ?? 150)) / o.rate);
    let prev = 0;
    for (let i = 0; i < n; i++) src[i] = prev = (1 - k) * src[i]! + k * prev;
  }
  // (aspiration: white noise at the glottis, not shaped by it, so that it shows above the harmonics in the highs)
  if (o.breath) {
    const pulseRms = Math.sqrt(src.reduce((a, v) => a + v * v, 0) / n);
    for (let i = 0; i < n; i++) src[i] = src[i]! + gauss(r) * pulseRms * o.breath;
  }
  let y = src;
  for (const [F, B] of o.formants ?? [
    [700, 90],
    [1200, 110],
    [2600, 160],
  ]) {
    const rr = Math.exp((-Math.PI * B) / o.rate);
    const c1 = 2 * rr * Math.cos((2 * Math.PI * F) / o.rate),
      c2 = -rr * rr;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = y[i]! + c1 * (i > 0 ? out[i - 1]! : 0) + c2 * (i > 1 ? out[i - 2]! : 0);
    y = out;
  }
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = y[i]! - (i ? y[i - 1]! : 0);
  if (o.envelope) for (let i = 0; i < n; i++) x[i] = x[i]! * o.envelope(i / o.rate);
  return toRms(x, o.rms ?? 0.1);
}

/**
 * syllable bursts: `perSecond` bursts a second (a raised cosine over `share` of each), and after every `group` bursts a
 * pause of `pause` seconds; 0 outside `[0, seconds)`
 */
export function bursts(perSecond: number, opts: { share?: number; group?: number; pause?: number; floor?: number } = {}): (t: number) => number {
  const share = opts.share ?? 0.7;
  const group = opts.group ?? Infinity;
  const pause = opts.pause ?? 0;
  const period = 1 / perSecond;
  const groupLen = group * period + pause;
  const floor = opts.floor ?? 0;
  return (t: number) => {
    const inGroup = Number.isFinite(groupLen) ? t % groupLen : t;
    if (inGroup >= group * period) return 0;
    const ph = (inGroup % period) / period;
    if (ph >= share) return floor;
    return floor + (1 - floor) * (0.5 - 0.5 * Math.cos((2 * Math.PI * ph) / share));
  };
}
