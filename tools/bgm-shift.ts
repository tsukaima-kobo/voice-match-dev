// BGM 入りの音のずれ: 同じ動画の同じ 30 秒を、ブラウザーでそのままの音（BGM 入り）で測った数字と、
// スプレッドシートの「声の測定値」（声を抜き出した音）とで比べ、項目ごとのずれの向き（平均）と揺れ（標準偏差）を data/bgm-shift.json に書く。
// tools/eval.ts がそれを使って data/model-bgm.json（ほかのタブの音を聞かせた時のモデル）を作る。
// 使い方: node tools/bgm-shift.ts --sheet <シートの xlsx> <ブラウザーで測った json>…
//   json は [{ id: 人物ID, video: 動画 ID, out: [{ start: 区間の開始秒, ok, ad, features }] }]（音は入らない。数字だけ）
// 書き出すのは項目ごとの数字 2 つずつと、組の数・人数だけ（人の名前や ID は書かない）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readXlsx } from './xlsx.ts';
import { transform } from './lib.ts';
import { FEATURE_BY_KEY, FEATURE_KEYS, type FeatureKey, type Features } from '../src/voice/features.ts';
import { sheetLabel } from './operator-voices-lib.ts';

const args = process.argv.slice(2);
const at = args.indexOf('--sheet');
const sheet = at >= 0 ? args[at + 1] : undefined;
const files = args.filter((_, i) => i !== at && i !== at + 1);
if (!sheet || !files.length) {
  console.error('使い方: node tools/bgm-shift.ts --sheet <シートの xlsx> <ブラウザーで測った json>…');
  process.exit(2);
}

const table = readXlsx(readFileSync(sheet)).get('声の測定値');
if (!table) throw new Error('シートに「声の測定値」のタブがありません');
const h = table.findIndex((r) => r[0] === '人物ID');
const head = (table[h] ?? []).map(String);
const col = (name: string) => {
  const i = head.indexOf(name);
  if (i < 0) throw new Error(`「声の測定値」に無い見出し: ${name}`);
  return i;
};
const cId = col('人物ID'),
  cVideo = col('出典動画ID'),
  cStart = col('測定区間の開始秒');
const cKeys = FEATURE_KEYS.map((k) => col(sheetLabel(k)));
const separated = new Map<string, Features>();
for (const r of table.slice(h + 1)) {
  if (!r[cId]) continue;
  separated.set(`${r[cId]}|${r[cVideo]}|${r[cStart]}`, Object.fromEntries(FEATURE_KEYS.map((k, i) => [k, typeof r[cKeys[i]!] === 'number' ? (r[cKeys[i]!] as number) : null])) as Features);
}

type Measured = { id: string; video: string; out: { start: number; ok: boolean; ad?: boolean; features: Features | null }[] };
const diffs = new Map<FeatureKey, number[]>(FEATURE_KEYS.map((k) => [k, []]));
const people = new Set<string>();
let pairs = 0;
for (const file of files)
  for (const m of JSON.parse(readFileSync(file, 'utf8')) as Measured[])
    for (const w of m.out) {
      const s = separated.get(`${m.id}|${m.video}|${w.start}`);
      if (!w.ok || w.ad || !w.features || !s || s.pitch === null) continue;
      pairs++;
      people.add(m.id);
      for (const k of FEATURE_KEYS) {
        const a = w.features[k],
          b = s[k];
        if (a !== null && b !== null) diffs.get(k)!.push(transform(k, a) - transform(k, b));
      }
    }
if (pairs < 20) throw new Error(`比べられた組が ${pairs} です（20 以上いります）`);

const round = (x: number) => Math.round(x * 1e5) / 1e5;
const shift: Partial<Record<FeatureKey, number>> = {};
const spread: Partial<Record<FeatureKey, number>> = {};
for (const k of FEATURE_KEYS) {
  const d = diffs.get(k)!;
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  shift[k] = round(mean);
  spread[k] = round(Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, d.length - 1)));
}
const out = {
  about: 'ほかのタブの音（BGM 入り）と、声を抜き出した音の差。shift は平均（来た人の数字から引く）、spread は標準偏差（同じ人の中の揺れに足す）。照合の変換後の単位（log の項目は自然対数）',
  pairs,
  people: people.size,
  shift,
  spread,
};
writeFileSync(join(import.meta.dirname, '../data/bgm-shift.json'), JSON.stringify(out, null, 1) + '\n');
const top = FEATURE_KEYS.map((k) => [k, Math.hypot(shift[k]!, spread[k]!)] as const).sort((a, b) => b[1] - a[1]);
console.log(`data/bgm-shift.json: ${pairs} 組・${people.size} 人。ずれが大きい項目: ${top.slice(0, 5).map(([k]) => FEATURE_BY_KEY[k].name).join('・')}`);
