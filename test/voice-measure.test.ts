// src/voice/measure.ts の試験。数字から作った合成音だけを使う（録音なし。乱数は種つき）。
// 1. 同じ音なら同じ数字。2. 各項目が言葉どおりに動く。3. 測れない時は理由を言う。
// 人の声での確かめ（Praat との比較・配信の音との差）は、ここではなく tools/channel.ts と本物の声で行う。
import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS, FEATURE_BY_KEY } from '../src/voice/features.ts';
import { measureVoice, MIN_VOICED_SECONDS, quantileOf, resample, type Measured } from '../src/voice/measure.ts';
import { bursts, concat, gauss, mixIn, rng, silence, tone, vowel } from './voice-synth.ts';

const R = 16000;
const inRoom = (x: Float32Array, rate = R) => concat(silence(rate, 0.6), x, silence(rate, 0.6, 0.0003, 9));
const ok = (m: Measured) => {
  if (!m.ok) throw new Error(`not measured: ${m.reason} ${JSON.stringify(m.info)}`);
  return m;
};
const num = (v: number | null): number => {
  if (v === null) throw new Error('missing');
  return v;
};
/** 話し声のような F0: `mid` Hz を中心にした三角形。上から下まで `span` 半音、2 秒に 1 回 */
const glide = (span: number, mid = 150) => (t: number) => mid * 2 ** ((span * 2 * (Math.abs(((t * 0.5) % 1) - 0.5) - 0.25)) / 12);
const syllables = bursts(5, { share: 0.8, floor: 0.4 });
const talk = bursts(5, { share: 0.8, floor: 0.3, group: 7, pause: 0.4 });
const increasing = (v: number[]) => v.every((x, i) => i === 0 || x > v[i - 1]!);

describe('同じ音なら同じ数字', () => {
  const clip = inRoom(vowel({ rate: 48000, seconds: 6, f0: glide(8), jitter: 0.01, shimmer: 0.04, breath: 0.02, envelope: talk }), 48000);
  it('同じサンプルなら、どの形で持っていても全く同じ結果', () => {
    const a = measureVoice(clip, 48000);
    expect(a.ok).toBe(true);
    for (const b of [measureVoice(clip, 48000), measureVoice(Array.from(clip), 48000), measureVoice(Float32Array.from(clip), 48000)]) expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
  it('全項目を、それぞれの桁に丸めて出す。サンプルには触らない', () => {
    const before = Float32Array.from(clip);
    const m = ok(measureVoice(clip, 48000));
    expect(Object.keys(m.features)).toEqual([...FEATURE_KEYS]);
    for (const k of FEATURE_KEYS) {
      const v = m.features[k];
      if (v === null) continue;
      const p = 10 ** FEATURE_BY_KEY[k].digits;
      expect(Math.round(v * p) / p, k).toBe(v);
    }
    // 間と音節のある話し声: 無いのは F4（合成の母音は響きが 3 つ）と
    // 速さのムラ（6 s では 1 s の区間が 4 つに満たない）だけ
    expect(FEATURE_KEYS.filter((k) => m.features[k] === null)).toEqual(['f4', 'rateVar']);
    expect(clip).toEqual(before);
  });
  it('同じ音を、16・22.05・44.1・48 kHz で同じように測る', () => {
    const at = (rate: number) => ok(measureVoice(inRoom(vowel({ rate, seconds: 5, f0: glide(4, 211), envelope: syllables }), rate), rate));
    const all = [16000, 22050, 44100, 48000].map(at);
    for (const m of all) expect(Math.abs(num(m.features.pitch) / 211 - 1)).toBeLessThan(0.02);
    for (const m of all) expect(Math.abs(num(m.features.f2) / num(all[0]!.features.f2) - 1)).toBeLessThan(0.03);
  });
  it('音量では変わらない（12 dB 小さくしても、音色と強さは同じ）', () => {
    const loud = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 5, f0: glide(4), envelope: syllables, rms: 0.2 })), R));
    const quiet = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 5, f0: glide(4), envelope: syllables, rms: 0.05 })), R));
    for (const k of ['pitch', 'f1', 'f2', 'f3', 'mfcc1', 'mfcc2', 'mfcc3', 'mfcc4', 'tilt', 'levelRange', 'centroid', 'hammarberg'] as const) {
      expect(Math.abs(num(quiet.features[k]) - num(loud.features[k])), k).toBeLessThanOrEqual(Math.abs(num(loud.features[k])) * 0.01 + 0.05);
    }
  });
});

describe('小さな BGM', () => {
  it('話し声の下で小さな曲と雑音が鳴っても（−20 dB）数字は近いまま: 背景は間で覚えて取り除く', () => {
    const voice = inRoom(vowel({ rate: R, seconds: 12, f0: glide(4), jitter: 0.006, shimmer: 0.03, breath: 0.02, envelope: talk, rms: 0.1 }));
    const tune = new Float32Array(voice.length);
    const r = rng(3);
    for (let i = 0; i < tune.length; i++) {
      const t = i / R;
      const chord = Math.floor(t / 2) % 2 ? [196, 246.9, 293.7] : [220, 277.2, 329.6];
      let v = 0;
      for (const f of chord) for (let h = 1; h <= 3; h++) v += Math.sin(2 * Math.PI * f * h * t) / (h * h);
      tune[i] = v + (r() - 0.5) * 0.3;
    }
    let ms = 0;
    for (const v of tune) ms += v * v;
    const k = (0.1 * 10 ** (-20 / 20)) / Math.sqrt(ms / tune.length);
    for (let i = 0; i < tune.length; i++) tune[i] = tune[i]! * k;
    const clean = ok(measureVoice(voice, R));
    const under = ok(measureVoice(mixIn(Float32Array.from(voice), tune), R));
    expect(Math.abs(num(under.features.pitch) / num(clean.features.pitch) - 1)).toBeLessThan(0.01);
    for (const key of ['mfcc1', 'mfcc2', 'mfcc3', 'mfcc4'] as const) expect(Math.abs(num(under.features[key]) - num(clean.features[key])), key).toBeLessThan(0.5);
    expect(Math.abs(num(under.features.centroid) / num(clean.features.centroid) - 1)).toBeLessThan(0.02);
    expect(Math.abs(num(under.features.tilt) - num(clean.features.tilt))).toBeLessThan(1);
    expect(Math.abs(num(under.features.hnr) - num(clean.features.hnr))).toBeLessThan(2);
  });
});

describe('高さ', () => {
  it('80〜400 Hz の倍音のある音の F0 を、0.5 % 以内で見つける', () => {
    for (const f of [80, 95, 123.4, 160, 211, 250, 300, 400]) {
      const m = ok(measureVoice(inRoom(tone({ rate: R, seconds: 4, f0: f })), R));
      expect(Math.abs(num(m.features.pitch) / f - 1), `${f} Hz`).toBeLessThan(0.005);
    }
  });
  it('抑揚は話し声のような高さの移りの幅に、高さの動きはその速さに沿う', () => {
    const spans = [2, 5, 10];
    const got = spans.map((s) => ok(measureVoice(inRoom(vowel({ rate: R, seconds: 6, f0: glide(s), envelope: syllables })), R)));
    got.forEach((m, i) => expect(Math.abs(num(m.features.pitchRange) - 0.8 * spans[i]!)).toBeLessThan(0.6));
    // 高さは 1 秒に `span` 半音動く
    got.forEach((m, i) => expect(Math.abs(num(m.features.pitchMotion) - spans[i]!)).toBeLessThan(0.25 * spans[i]! + 0.3));
    expect(increasing(got.map((m) => num(m.features.pitchMotion)))).toBe(true);
  });
  it('高さの偏り: ときどき跳ね上がる声は上に偏る。上下対称の移りは 0 に近い', () => {
    const sym = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 6, f0: glide(6), envelope: syllables })), R));
    // ほとんど 150 Hz。1.5 s ごとに 0.3 s だけ、最大 8 半音高くなる
    const up = (t: number) => 150 * 2 ** ((t % 1.5 < 0.3 ? 8 * Math.sin((Math.PI * (t % 1.5)) / 0.3) : 0) / 12);
    const lean = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 6, f0: up, envelope: syllables })), R));
    expect(Math.abs(num(sym.features.pitchSkew))).toBeLessThan(1);
    expect(num(lean.features.pitchSkew)).toBeGreaterThan(2);
  });
});

describe('響き（フォルマント）', () => {
  const at = (formants: [number, number][], f0 = 120) => ok(measureVoice(inRoom(vowel({ rate: R, seconds: 4, f0, formants })), R));
  it('合成の母音（低い声）の F1 を 10 % 以内、F2 と F3 を 8 % 以内で見つける', () => {
    const vowels: [number, number, number][] = [
      [300, 2300, 3000],
      [750, 1200, 2600],
      [500, 1500, 2500],
      [400, 900, 2400],
    ];
    for (const [a, b, c] of vowels) {
      const m = at([
        [a, 70],
        [b, 100],
        [c, 150],
      ]);
      // 低い倍音に近い F1 は、少しそちらに引っ張られる: 10 %
      expect(Math.abs(num(m.features.f1) / a - 1), `F1 of ${a}`).toBeLessThan(0.1);
      expect(Math.abs(num(m.features.f2) / b - 1), `F2 of ${b}`).toBeLessThan(0.08);
      expect(Math.abs(num(m.features.f3) / c - 1), `F3 of ${c}`).toBeLessThan(0.08);
    }
  });
  it('響きの間隔: 短い声道（フォルマントが全部 20 % 上がる）は広く出る', () => {
    const long = at([
      [500, 80],
      [1500, 100],
      [2500, 150],
    ]);
    const short = at([
      [600, 80],
      [1800, 100],
      [3000, 150],
    ]);
    expect(Math.abs(num(long.features.formantSpacing) - 1000)).toBeLessThan(60);
    expect(num(short.features.formantSpacing) / num(long.features.formantSpacing)).toBeGreaterThan(1.12);
  });
  it('F4 は 4 つめの響きに沿う', () => {
    for (const f4 of [3400, 4200]) {
      const m = at([
        [500, 80],
        [1500, 100],
        [2500, 150],
        [f4, 200],
      ]);
      expect(Math.abs(num(m.features.f4) / f4 - 1), `F4 of ${f4}`).toBeLessThan(0.08);
    }
  });
  it('F1 の幅: 1 つめの響きが広ければ、広く出る', () => {
    const narrow = at([
      [600, 60],
      [1500, 100],
      [2500, 150],
    ]);
    const wide = at([
      [600, 220],
      [1500, 100],
      [2500, 150],
    ]);
    expect(num(wide.features.b1)).toBeGreaterThan(1.5 * num(narrow.features.b1));
  });
  it('口の開きの幅・舌の動きの幅・音色の動き: 変わっていく母音は、1 つの母音を伸ばすより広く、よく動いて出る', () => {
    const vs: [number, number][][] = [
      [
        [700, 90],
        [1200, 110],
        [2600, 160],
      ],
      [
        [300, 70],
        [2300, 100],
        [3000, 150],
      ],
      [
        [500, 80],
        [1500, 100],
        [2500, 150],
      ],
    ];
    const held = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 6, f0: 120, formants: vs[0], envelope: syllables })), R));
    const changing = ok(measureVoice(inRoom(concat(...Array.from({ length: 40 }, (_, i) => vowel({ rate: R, seconds: 0.15, f0: 120, formants: vs[i % 3], seed: i + 1 })))), R));
    expect(num(changing.features.f1Range)).toBeGreaterThan(num(held.features.f1Range) + 5);
    expect(num(changing.features.f2Range)).toBeGreaterThan(num(held.features.f2Range) + 5);
    expect(num(changing.features.mfccDelta)).toBeGreaterThan(2 * num(held.features.mfccDelta));
  });
  it('明るさ: 響きが高いほど明るく出る', () => {
    const dark = at([
      [450, 80],
      [800, 90],
      [2400, 150],
    ]);
    const bright = at([
      [700, 110],
      [2000, 130],
      [3000, 170],
    ]);
    expect(num(dark.features.centroid)).toBeLessThan(num(bright.features.centroid));
  });
});

describe('声の質', () => {
  const voice = (o: { breath?: number; jitter?: number; shimmer?: number; glottis?: number }) => ok(measureVoice(inRoom(vowel({ rate: R, seconds: 5, f0: glide(6), envelope: syllables, seed: 5, ...o })), R));
  it('息が多いと、澄み（HNR）とはっきりさ（CPP）が下がる', () => {
    const got = [0, 0.03, 0.06, 0.1].map((b) => voice({ breath: b }));
    expect(increasing(got.map((m) => -num(m.features.hnr)))).toBe(true);
    expect(increasing(got.map((m) => -num(m.features.cpp)))).toBe(true);
  });
  it('jitter と shimmer が多いと、ゆらぎが大きくなる', () => {
    const got = [0, 0.01, 0.02, 0.04].map((j) => voice({ jitter: j, shimmer: 4 * j }));
    expect(increasing(got.map((m) => num(m.features.jitter)))).toBe(true);
    expect(increasing(got.map((m) => num(m.features.shimmer)))).toBe(true);
  });
  it('柔らかさ（H1−H2）: 柔らかい音源（高い音が早く下がる）ほど高く出る', () => {
    const got = [600, 250, 120, 70].map((g) => voice({ glottis: g }));
    expect(increasing(got.map((m) => num(m.features.h1h2)))).toBe(true);
    // 声の力は逆向き
    expect(increasing(got.map((m) => -num(m.features.tilt)))).toBe(true);
  });
});

describe('話す速さと間', () => {
  it('音節のような音のかたまりを、1 秒あたりで数える', () => {
    const per = [3, 4, 5, 6, 7];
    const got = per.map((n) => ok(measureVoice(inRoom(vowel({ rate: R, seconds: 6, f0: glide(4, 180), envelope: bursts(n, { share: 0.75 }) })), R)));
    got.forEach((m, i) => expect(Math.abs(num(m.features.rate) - per[i]!)).toBeLessThan(0.25));
  });
  it('間を測る: 間の割合・間の長さ・間と間の区間', () => {
    const pauses = [0.3, 0.6, 1.0];
    const got = pauses.map((p) => ok(measureVoice(inRoom(vowel({ rate: R, seconds: 10, f0: glide(4, 180), envelope: bursts(5, { share: 0.75, group: 6, pause: p }) })), R)));
    expect(increasing(got.map((m) => num(m.features.pauseShare)))).toBe(true);
    got.forEach((m, i) => expect(Math.abs(num(m.features.pauseLen) - pauses[i]!), `pause ${pauses[i]}`).toBeLessThan(0.12));
    // 1 秒に 5 つで 6 つひとまとまり: 1.2 s。最後のかたまりの終わりの分だけ少し短い
    for (const m of got) expect(Math.abs(num(m.features.runLen) - 1.15)).toBeLessThan(0.15);
  });
  it('間が全く無い時: 間の長さは作らずに、無しにする', () => {
    const m = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 6, f0: glide(4), envelope: bursts(5, { share: 0.75 }) })), R));
    expect(m.features.pauseShare).toBe(0);
    expect(m.features.pauseLen).toBe(null);
  });
  it('速さのムラ: 同じ速さの区間が続けば低く、速い区間と遅い区間が交互なら高い', () => {
    // 1.6 s の区間と 0.5 s の間。i 番目の区間では、音節は 1 秒に `per(i)` 個
    const env = (per: (i: number) => number) => (t: number) => {
      const i = Math.floor(t / 2.1),
        u = t - i * 2.1;
      if (u >= 1.6) return 0;
      const ph = (u * per(i)) % 1;
      return ph < 0.75 ? 0.4 + 0.6 * (0.5 - 0.5 * Math.cos((2 * Math.PI * ph) / 0.75)) : 0.4;
    };
    const even = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 12.6, f0: glide(4, 180), envelope: env(() => 5) })), R));
    const uneven = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 12.6, f0: glide(4, 180), envelope: env((i) => (i % 2 ? 7 : 3)) })), R));
    expect(num(even.features.rateVar)).toBeLessThan(0.1);
    expect(num(uneven.features.rateVar)).toBeGreaterThan(0.25);
  });
  it('リズムのムラ: 音節がそろっていれば低く、そろっていなければ高い', () => {
    const even = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 8, f0: glide(4), envelope: bursts(5, { share: 0.75 }) })), R));
    // 0.12 s のかたまり。山と山の間は長い・短いの繰り返し: 0.35 s、0.15 s、…
    const lilt = (t: number) => {
      const ph = t % 0.5;
      const u = ph < 0.35 ? ph / 0.12 : (ph - 0.35) / 0.12;
      return u < 1 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * u) : 0;
    };
    const uneven = ok(measureVoice(inRoom(vowel({ rate: R, seconds: 8, f0: glide(4), envelope: lilt })), R));
    expect(num(even.features.rhythm)).toBeLessThan(15);
    expect(num(uneven.features.rhythm)).toBeGreaterThan(num(even.features.rhythm) + 30);
  });
});

describe('測れない時は、その理由', () => {
  it('音が無い・部屋の音だけ: silent', () => {
    expect(measureVoice(silence(R, 5, 0), R)).toMatchObject({ ok: false, reason: 'silent' });
    expect(measureVoice(silence(R, 5), R)).toMatchObject({ ok: false, reason: 'silent' });
  });
  it('声が小さすぎる: quiet', () => {
    const m = measureVoice(concat(silence(R, 0.6, 0.00001), tone({ rate: R, seconds: 4, f0: 150, rms: 0.0007 }), silence(R, 0.6, 0.00001)), R);
    expect(m).toMatchObject({ ok: false, reason: 'quiet' });
  });
  it('絶えず続く雑音の下の声: noisy', () => {
    const x = inRoom(tone({ rate: R, seconds: 4, f0: 150 }));
    const r = rng(3);
    expect(measureVoice(mixIn(x, Float32Array.from({ length: x.length }, () => gauss(r) * 0.04)), R)).toMatchObject({ ok: false, reason: 'noisy' });
  });
  it('最大の所で切れた声: clipped', () => {
    const x = inRoom(tone({ rate: R, seconds: 4, f0: 150, rms: 0.9 }));
    for (let i = 0; i < x.length; i++) x[i] = Math.max(-1, Math.min(1, x[i]!));
    expect(measureVoice(x, R)).toMatchObject({ ok: false, reason: 'clipped' });
  });
  it(`声が求めた長さより少ない: short（決まりは ${MIN_VOICED_SECONDS} s。ページはもっと求める）`, () => {
    expect(measureVoice(inRoom(tone({ rate: R, seconds: 2, f0: 150 })), R)).toMatchObject({ ok: false, reason: 'short' });
    const five = inRoom(vowel({ rate: R, seconds: 5, f0: 150 }));
    expect(measureVoice(five, R).ok).toBe(true);
    expect(measureVoice(five, R, { minVoicedSeconds: 8 })).toMatchObject({ ok: false, reason: 'short' });
  });
  it('録音でない: invalid', () => {
    expect(measureVoice(new Float32Array(0), R)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(measureVoice(tone({ rate: R, seconds: 4, f0: 150 }), 4000)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('音楽が混ざった時の目印', () => {
  it('間でも鳴り続ける音は、gapTonal を上げる', () => {
    const talkOnly = inRoom(vowel({ rate: R, seconds: 8, f0: glide(4), envelope: talk }));
    const clean = ok(measureVoice(talkOnly, R));
    expect(clean.info.gapTonal).toBeLessThan(0.05);
    const music = tone({ rate: R, seconds: 8 + 1.2, f0: 440, rms: 0.006 });
    const withMusic = ok(measureVoice(mixIn(Float32Array.from(talkOnly), music), R));
    expect(withMusic.info.gapTonal).toBeGreaterThan(0.5);
  });
});

describe('BGM やほかの人の声が混ざる音（bgm、ほかのタブの音の時だけ）', () => {
  const main = vowel({ rate: R, seconds: 20, f0: glide(8, 260), jitter: 0.01, shimmer: 0.04, breath: 0.02, envelope: talk });
  it('きれいな声 1 人分なら、何も変えない', () => {
    const clip = inRoom(main);
    expect(JSON.stringify(measureVoice(clip, R, { bgm: true }))).toBe(JSON.stringify(measureVoice(clip, R)));
  });
  it('1 オクターブより離れた低い声を除くので、高さとその幅が主な声に戻る', () => {
    const clean = ok(measureVoice(inRoom(main), R));
    const low = vowel({ rate: R, seconds: 20, f0: glide(6, 105), seed: 5, envelope: bursts(4, { share: 0.7, floor: 0.2, group: 5, pause: 1.5 }) });
    const mixed = inRoom(mixIn(Float32Array.from(main), Array.from(low, (v) => v * 0.6)));
    const plain = ok(measureVoice(mixed, R));
    const bgm = ok(measureVoice(mixed, R, { bgm: true }));
    const off = (m: typeof clean, k: 'pitchRange' | 'pitch') => Math.abs(num(m.features[k]) - num(clean.features[k]));
    expect(off(plain, 'pitchRange')).toBeGreaterThan(5);
    expect(off(bgm, 'pitchRange')).toBeLessThan(1.5);
    expect(off(bgm, 'pitch')).toBeLessThan(off(plain, 'pitch'));
  });
});

describe('小さな道具', () => {
  it('quantileOf（順位の間は直線でつなぐ）', () => {
    expect(quantileOf([3, 1, 2, 4], 0.5)).toBe(2.5);
    expect(Number.isNaN(quantileOf([], 0.5))).toBe(true);
  });
  it('resample は音の大きさと周波数を保つ', () => {
    const x = Float64Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5);
    const y = resample(x, 48000, 16000);
    expect(y.length).toBe(16000);
    const mid = y.subarray(1000, 15000);
    expect(Math.sqrt(mid.reduce((a, v) => a + v * v, 0) / mid.length)).toBeCloseTo(0.5 / Math.SQRT2, 3);
  });
});
