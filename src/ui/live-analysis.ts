// 録っている間の解析パネル: 入ってくる声を、その場で少しだけ計算して見せる（声の成分の図・高さの線・数字・測れる項目）。
// どれも本当に計算した値（飾りの乱数は使わない）。最後の数字は measure.ts が出す。ここは、測っている様子を見せるためだけ。
//   声の成分の図（スペクトログラム）: 16 kHz にして 20 ms ごとに FFT（512）。縦は 80 Hz〜8 kHz の対数、色は強さ。
//   高さの線: 20 ms ごとに、測る時と同じ探し方（measure.ts の pitchNow。60〜1100 Hz。歌や高い声真似も追う。上限より高い音は
//            1 オクターブ下と取り違えず、捨てる）。線と最後の数字が食い違わないように。同じ縦の目盛り（80 Hz〜8 kHz）で、成分の図の
//            上に重ねる。高さを見るには前後の音が要るので、図と線は 64 ms 遅れて出る。
//   数字: 声の高さ（中央値。Hz と音名）・抑揚（10〜90 %、半音）・明るさ（300 Hz〜4 kHz の重心）・大きさ（dBFS）・声の秒数。
//   測れる項目: 声の秒数が、項目ごとに要る長さ（features.ts の needOf）に届くと光る。
// 音は持たない（直近 128 ms だけを、計算のために持つ）。話し終えた後は、45 項目が順に光る「計算中」の演出（その間に Worker が測る）。
import { FEATURE_KEYS, FEATURES, FEW_SECONDS, GROUP_NAMES, LONG_SECONDS, needOf, ONE_LINE_SECONDS, type FeatureGroup } from '../voice/features.ts';
import { onLang, t } from '../i18n.ts';
import { NOW_LEN, pitchNow } from '../voice/measure.ts';

export type LiveMode = 'off' | 'listening' | 'analysing' | 'done';
export interface LiveAnalysis {
  push(x: Float32Array, rate: number): void;
  reset(): void;
  mode(m: LiveMode): void;
  /** 計算中の演出（少なくとも ms ミリ秒）。動きを減らす設定では、すぐ終わる */
  analysing(ms: number): Promise<void>;
}

const SR = 16000;
const HOP = 320;
const N = 512;
const F_LO = 80,
  F_HI = 8000;
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/* ---- 小さな FFT（実数 512 点を、複素 512 点で） ---- */
const REV = new Uint16Array(N);
for (let i = 0, j = 0; i < N; i++) {
  REV[i] = j;
  let bit = N >> 1;
  while (j & bit) {
    j ^= bit;
    bit >>= 1;
  }
  j |= bit;
}
const COS = Float64Array.from({ length: N / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / N));
const SIN = Float64Array.from({ length: N / 2 }, (_, i) => -Math.sin((2 * Math.PI * i) / N));
const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
function powerSpectrum(x: Float32Array, out: Float32Array, re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < N; i++) {
    re[REV[i]!] = x[i]! * HANN[i]!;
    im[REV[i]!] = 0;
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1,
      step = N / size;
    for (let i = 0; i < N; i += size)
      for (let j = 0; j < half; j++) {
        const k = j * step;
        const tr = re[i + j + half]! * COS[k]! - im[i + j + half]! * SIN[k]!;
        const ti = re[i + j + half]! * SIN[k]! + im[i + j + half]! * COS[k]!;
        re[i + j + half] = re[i + j]! - tr;
        im[i + j + half] = im[i + j]! - ti;
        re[i + j] = re[i + j]! + tr;
        im[i + j] = im[i + j]! + ti;
      }
  }
  for (let k = 0; k <= N / 2; k++) out[k] = (re[k]! * re[k]! + im[k]! * im[k]!) / (N * N);
}

/** 直近の音（16 kHz。終わりの NOW_LEN サンプル）の真ん中の高さ（Hz。無い時・60〜1100 Hz の外の時は 0）。測る時と同じ探し方 */
export function pitchOf(x: Float32Array): number {
  return pitchNow(x);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function createLiveAnalysis(box: HTMLElement): LiveAnalysis {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  box.classList.add('live');
  box.dataset.mode = 'off';
  box.setAttribute('aria-hidden', 'true');

  // パネル
  const head = el('div', 'live-head');
  const title = el('span', 'live-title');
  const count = el('span', 'live-count');
  const countN = el('b', undefined, '0');
  const countOf = document.createTextNode('');
  count.append(countN, countOf);
  head.append(title, count);
  const scope = el('div', 'live-scope');
  const spec = el('canvas', 'live-spec');
  const axis = el('div', 'live-axis');
  for (const f of [100, 200, 500, 1000, 2000, 4000]) {
    const t = el('span', undefined, f >= 1000 ? `${f / 1000}k` : String(f));
    t.style.bottom = `${(Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * 100}%`;
    axis.append(t);
  }
  const scan = el('div', 'live-scanline');
  scope.append(spec, axis, scan);
  const read = el('div', 'live-read');
  const labels: (() => void)[] = [];
  const cell = (label: [string, string], unit: [string, string]) => {
    const c = el('div', 'live-cell');
    const v = el('b', undefined, '—');
    const l = el('span'),
      u = el('small');
    labels.push(() => {
      l.textContent = t(...label);
      u.textContent = t(...unit);
    });
    c.append(l, v, u);
    read.append(c);
    return v;
  };
  const vPitch = cell(['声の高さ', 'Pitch'], ['Hz', 'Hz']),
    vNote = cell(['音名', 'Note'], ['', '']),
    vRange = cell(['抑揚', 'Intonation'], ['半音', 'st']),
    vBright = cell(['明るさ', 'Brightness'], ['Hz', 'Hz']),
    vLevel = cell(['大きさ', 'Level'], ['dB', 'dB']),
    vVoiced = cell(['声', 'Voice'], ['秒', 's']);
  const tiers = el('div', 'live-tiers');
  const tierDefs: [number, string, string][] = [
    [ONE_LINE_SECONDS, '一言: 高さ・響き・音色・声の質', 'A word: pitch, resonance, timbre, quality'],
    [FEW_SECONDS, '抑揚・口の開き・音色の動き', 'Intonation, mouth opening, timbre movement'],
    [LONG_SECONDS, '速さと間・リズム', 'Tempo, pauses and rhythm'],
  ];
  const tierEls = tierDefs.map(([sec, ja, en]) => {
    const row = el('div', 'live-tier');
    const bar = el('i');
    const l = el('span'),
      u = el('small');
    labels.push(() => {
      l.textContent = t(ja, en);
      u.textContent = t(`${sec} 秒`, `${sec} s`);
    });
    row.append(l, bar, u);
    tiers.append(row);
    return { t: row, bar, sec };
  });
  const items = el('div', 'live-items');
  const chips: { el: HTMLElement; need: number }[] = [];
  const groups = [...new Set(FEATURES.map((d) => d.group))] as FeatureGroup[];
  for (const g of groups) {
    const row = el('div', 'live-group');
    const gname = el('span', 'live-gname');
    row.append(gname);
    labels.push(() => (gname.textContent = GROUP_NAMES[g]));
    for (const d of FEATURES.filter((x) => x.group === g)) {
      const c = el('span', 'live-chip');
      labels.push(() => (c.textContent = d.name));
      row.append(c);
      chips.push({ el: c, need: needOf(d.key) });
    }
    items.append(row);
  }
  const status = el('p', 'live-status');
  box.replaceChildren(head, scope, read, tiers, items, status);
  let statusText: [string, string] | null = null;
  const titleFor = (m: LiveMode) => (m === 'analysing' ? t('解析中', 'Analysing') : m === 'done' ? t('解析しました', 'Analysed') : t('リアルタイム解析', 'Live analysis'));
  const relabel = () => {
    for (const f of labels) f();
    countOf.textContent = t(` / ${FEATURE_KEYS.length} 項目`, ` / ${FEATURE_KEYS.length} items`);
    title.textContent = titleFor(current);
    status.textContent = statusText ? t(...statusText) : '';
  };
  const say = (ja: string, en: string) => {
    statusText = [ja, en];
    status.textContent = t(ja, en);
  };

  // 状態
  // 16 kHz にした直近の 128 ms を、回して上書きする入れ物に持つ。計算のため、20 ms ごとにそのまま `ring` に写す。
  // 図の列と高さは、どちらもその真ん中（64 ms 前）の物
  const L = NOW_LEN;
  const mid = (L - N) >> 1;
  const circle = new Float32Array(L);
  const ring = new Float32Array(L);
  let w = 0;
  let filled = 0,
    sinceHop = 0,
    frac = 0,
    lastIn = 0,
    voiced = 0,
    pitches: number[] = [],
    cenNum = 0,
    cenDen = 0,
    lastLevel = -90,
    lastPitch = 0;
  const pw = new Float32Array(N / 2 + 1);
  const re = new Float64Array(N),
    im = new Float64Array(N);
  const frame = new Float32Array(N);
  const ctx = spec.getContext('2d')!;
  let rowBin: Float32Array = new Float32Array(0);
  let lut: Uint8ClampedArray | null = null;
  const columns: { col: Float32Array; pitch: number }[] = [];
  let raf = 0,
    current: LiveMode = 'off',
    lastText = 0;
  relabel();
  onLang(relabel);

  function palette(): Uint8ClampedArray {
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const cs = getComputedStyle(box);
    const rgb = (v: string): [number, number, number] => {
      probe.fillStyle = '#000';
      probe.fillStyle = v;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!];
    };
    const stops = [rgb(cs.getPropertyValue('--bg').trim() || '#111'), rgb(cs.getPropertyValue('--a3').trim() || '#6cf'), rgb(cs.getPropertyValue('--a2').trim() || '#85f'), rgb(cs.getPropertyValue('--a1').trim() || '#f48'), [255, 250, 252] as [number, number, number]];
    const out = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * (stops.length - 1);
      const k = Math.min(stops.length - 2, Math.floor(x)),
        t = x - k;
      for (let c = 0; c < 3; c++) out[i * 4 + c] = stops[k]![c]! + (stops[k + 1]![c]! - stops[k]![c]!) * t;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => (lut = null));

  /** 20 ms ごとの計算 */
  function hop(): void {
    ring.set(circle.subarray(w));
    ring.set(circle.subarray(0, w), L - w);
    frame.set(ring.subarray(mid, mid + N));
    powerSpectrum(frame, pw, re, im);
    let tot = 0;
    for (let i = mid; i < mid + N; i++) tot += ring[i]! * ring[i]!;
    const level = 10 * Math.log10(tot / N + 1e-12);
    const p = level > -50 ? pitchOf(ring) : 0;
    const isVoiced = p > 0;
    if (isVoiced) {
      voiced += HOP / SR;
      pitches.push(p);
      for (let k = Math.round(300 / (SR / N)); k <= Math.round(4000 / (SR / N)); k++) {
        cenNum += k * (SR / N) * pw[k]!;
        cenDen += pw[k]!;
      }
    }
    lastLevel = level;
    lastPitch = p;
    const col = new Float32Array(N / 2 + 1);
    col.set(pw);
    columns.push({ col, pitch: p });
    if (columns.length > 64) columns.splice(0, columns.length - 64);
  }

  function draw(): void {
    raf = 0;
    if (current === 'off') return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(spec.clientWidth * dpr)),
      H = Math.max(1, Math.round(spec.clientHeight * dpr));
    if (spec.width !== W || spec.height !== H) {
      spec.width = W;
      spec.height = H;
      rowBin = Float32Array.from({ length: H }, (_, y) => (F_LO * (F_HI / F_LO) ** (1 - y / (H - 1))) / (SR / N));
    }
    lut ??= palette();
    const colW = Math.max(1, Math.round(3 * dpr));
    const yOf = (f: number) => (1 - Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * (H - 1);
    // 新しい列: 絵は左へ動き、20 ms ごとに右端に 1 列を足す
    const fresh = columns.splice(0, columns.length);
    if (fresh.length) {
      const shift = Math.min(W, fresh.length * colW);
      ctx.drawImage(spec, -shift, 0);
      const img = ctx.createImageData(colW, H);
      fresh.forEach(({ col, pitch }, i) => {
        for (let y = 0; y < H; y++) {
          const b = rowBin[y]!;
          const k = Math.min(N / 2 - 1, Math.floor(b));
          const v = col[k]! + (col[k + 1]! - col[k]!) * (b - k);
          const db = 10 * Math.log10(v + 1e-14);
          const t = Math.min(255, Math.round(Math.max(0, (db + 88) / 62) ** 1.3 * 255));
          for (let x = 0; x < colW; x++) {
            const o = (y * colW + x) * 4;
            img.data[o] = lut![t * 4]!;
            img.data[o + 1] = lut![t * 4 + 1]!;
            img.data[o + 2] = lut![t * 4 + 2]!;
            img.data[o + 3] = 255;
          }
        }
        const x0 = W - shift + i * colW;
        ctx.putImageData(img, x0, 0);
        if (pitch > 0) {
          ctx.fillStyle = '#fff';
          ctx.shadowColor = '#fff';
          ctx.shadowBlur = 6 * dpr;
          ctx.fillRect(x0, yOf(pitch) - dpr, colW, 2.2 * dpr);
          ctx.shadowBlur = 0;
        }
      });
    }
    // 数字は 1 秒に 10 回
    const now = performance.now();
    if (now - lastText > 100) {
      lastText = now;
      const sorted = [...pitches].sort((a, b) => a - b);
      const q = (x: number) => sorted[Math.min(sorted.length - 1, Math.floor(x * sorted.length))]!;
      if (sorted.length >= 5) {
        const med = q(0.5);
        vPitch.textContent = med.toFixed(0);
        const midi = Math.round(69 + 12 * Math.log2(med / 440));
        vNote.textContent = `${NOTE[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
        vRange.textContent = sorted.length >= 25 ? (12 * Math.log2(q(0.9) / q(0.1))).toFixed(1) : '—';
      }
      if (cenDen > 0) vBright.textContent = (cenNum / cenDen).toFixed(0);
      vLevel.textContent = lastLevel > -89 ? lastLevel.toFixed(0) : '—';
      vVoiced.textContent = voiced.toFixed(1);
      let open = 0;
      for (const c of chips) {
        const on = voiced >= c.need;
        if (on) open++;
        if (on !== c.el.classList.contains('on')) c.el.classList.toggle('on', on);
      }
      countN.textContent = String(open);
      for (const t of tierEls) {
        t.bar.style.setProperty('--p', String(Math.min(1, voiced / t.sec)));
        t.t.classList.toggle('done', voiced >= t.sec);
      }
      box.classList.toggle('voicing', lastPitch > 0);
    }
    if (current === 'listening') raf = requestAnimationFrame(draw);
  }

  return {
    push(x, rate) {
      // サンプルの間を直線でつないで 16 kHz にする（絵には十分）。位置は [前のかたまりの最後, ...x] の中で数える
      const step = rate / SR;
      let p = frac;
      const at = (j: number) => (j === 0 ? lastIn : x[j - 1]!);
      while (p < x.length) {
        const i = Math.floor(p),
          t = p - i;
        circle[w] = at(i) + (at(i + 1) - at(i)) * t;
        w = (w + 1) % L;
        filled++;
        if (++sinceHop >= HOP) {
          sinceHop = 0;
          if (filled >= L) hop();
        }
        p += step;
      }
      frac = p - x.length;
      lastIn = x[x.length - 1] ?? lastIn;
      if (current === 'listening' && !raf) raf = requestAnimationFrame(draw);
    },
    reset() {
      ring.fill(0);
      circle.fill(0);
      w = 0;
      filled = sinceHop = 0;
      frac = 0;
      lastIn = 0;
      voiced = 0;
      pitches = [];
      cenNum = cenDen = 0;
      lastLevel = -90;
      lastPitch = 0;
      columns.length = 0;
      ctx.clearRect(0, 0, spec.width, spec.height);
      for (const v of [vPitch, vNote, vRange, vBright, vLevel]) v.textContent = '—';
      vVoiced.textContent = '0.0';
      for (const c of chips) c.el.classList.remove('on', 'calc', 'done');
      countN.textContent = '0';
      for (const t of tierEls) {
        t.bar.style.setProperty('--p', '0');
        t.t.classList.remove('done');
      }
      statusText = null;
      status.textContent = '';
    },
    mode(m) {
      current = m;
      box.dataset.mode = m;
      title.textContent = titleFor(m);
      if (m === 'listening') {
        say('話すほど、測れる項目が増えます', 'The more you speak, the more items can be measured');
        if (!raf) raf = requestAnimationFrame(draw);
      }
    },
    async analysing(ms) {
      // Worker で数字を計算している間、項目を 1 つずつ光らせる
      say(`${FEATURE_KEYS.length} 項目を計算しています…`, `Working out ${FEATURE_KEYS.length} items…`);
      if (reduce.matches) return;
      const per = Math.max(12, Math.floor(ms / chips.length));
      for (let i = 0; i < chips.length; i++) {
        const c = chips[i]!.el;
        c.classList.add('calc');
        setTimeout(() => {
          c.classList.remove('calc');
          c.classList.add('done');
        }, per * 3);
        await new Promise((r) => setTimeout(r, per));
      }
      await new Promise((r) => setTimeout(r, per * 3));
    },
  };
}
