// 経路の差: 同じ声を、配信でよくある経路（Opus・AAC の圧縮、コンプレッサーと音量そろえ、EQ）に通すと、各項目がどれだけ動くか。
// 配信で測ったお手本の声と、マイクで測った利用者の声の差の目安（照合の重みと、声真似の点数の幅の見直しに使う）。
// 使い方: node tools/channel.ts 声1.wav 声2.wav …  [--write]
//   --write で data/channel.json（項目ごとのずれの大きさ、照合の変換後の単位）を書く。tools/eval.ts がそれを使う。
// 渡す WAV は、本人の同意がある声だけ（運営自身の声など）。途中のファイルは一時フォルダーに作り、終わったら消す。
// ffmpeg が要る。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEATURE_KEYS, type FeatureKey, type Features } from '../src/voice/features.ts';
import { measureVoice } from '../src/voice/measure.ts';
import { transform } from './lib.ts';
import { readWav } from './wav.ts';

export const CHAINS: { name: string; encode: string[]; ext: string }[] = [
  { name: 'Opus 96k', encode: ['-c:a', 'libopus', '-b:a', '96k'], ext: 'opus' },
  { name: 'AAC 128k', encode: ['-c:a', 'aac', '-b:a', '128k'], ext: 'm4a' },
  { name: 'コンプ＋音量そろえ＋AAC', encode: ['-af', 'acompressor=threshold=-24dB:ratio=4:attack=5:release=120,loudnorm=I=-14:TP=-1.5', '-c:a', 'aac', '-b:a', '128k'], ext: 'm4a' },
  { name: '低域カット＋高域持ち上げ＋Opus', encode: ['-af', 'highpass=f=120,equalizer=f=4000:t=q:w=1:g=4', '-c:a', 'libopus', '-b:a', '96k'], ext: 'opus' },
];

function measureFile(path: string): Features | string {
  const { rate, samples } = readWav(readFileSync(path));
  const m = measureVoice(samples, rate, { minVoicedSeconds: 8 });
  return m.ok ? m.features : m.reason;
}

const args = process.argv.slice(2);
const write = args.includes('--write');
const files = args.filter((a) => a !== '--write');
if (!files.length) {
  console.log('使い方: node tools/channel.ts 声1.wav 声2.wav … [--write]');
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), 'voice-match-channel-'));
const diffs: Record<FeatureKey, number[]> = Object.fromEntries(FEATURE_KEYS.map((k) => [k, []])) as unknown as Record<FeatureKey, number[]>;
try {
  for (const file of files) {
    const orig = measureFile(file);
    if (typeof orig === 'string') {
      console.log(`${file}: 測れませんでした（${orig}）`);
      continue;
    }
    for (const c of CHAINS) {
      const enc = join(work, `x.${c.ext}`),
        dec = join(work, 'x.wav');
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, ...c.encode, enc]);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', enc, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', dec]);
      const got = measureFile(dec);
      if (typeof got === 'string') {
        console.log(`${file} / ${c.name}: 測れませんでした（${got}）`);
        continue;
      }
      for (const k of FEATURE_KEYS) {
        const a = orig[k],
          b = got[k];
        if (a !== null && b !== null) diffs[k].push(transform(k, b) - transform(k, a));
      }
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
const channel: Partial<Record<FeatureKey, number>> = {};
for (const k of FEATURE_KEYS) {
  const d = diffs[k];
  if (!d.length) continue;
  const rms = Math.sqrt(d.reduce((a, b) => a + b * b, 0) / d.length);
  channel[k] = Math.round(rms * 10000) / 10000;
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  console.log(`${k.padEnd(15)} ずれ(RMS) ${rms.toFixed(4)}  かたより ${mean >= 0 ? '+' : ''}${mean.toFixed(4)}  (${d.length} 件)`);
}
if (write) {
  writeFileSync(join(import.meta.dirname, '..', 'data/channel.json'), JSON.stringify(channel, null, 1) + '\n');
  console.log('data/channel.json を書きました');
}
