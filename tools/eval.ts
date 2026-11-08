// 照合のモデルを作り、見分ける力を測る。data/voices/ の窓から:
// 1. 項目ごとの再現性（ICC）
// 2. 2 つの作り方（項目ごとの散らばりだけ・白色化）で、1 本の動画を外して本人が 1 位・5 位以内に入る割合
// 3. よい方を data/model.json に書き、結果を data/eval-report.json に書く。近さの言葉の目安（likeness）もモデルに入れる
//    data/channel.json（マイクと配信の経路の差。tools/channel.ts）があれば、同じ人の中の揺れに足す。
// 使い方: node tools/eval.ts（data/voices/ の窓から）
//         node tools/eval.ts --sheet data/generated/<シート>.xlsx（運営が測った声の、スプレッドシートの窓から。tools/voices-release.ts と同じ窓を使う）
// 評価で外した動画は、モデルを作るのにも使わない（外した動画ごとに作り直す）。
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEASURE_VERSION } from '../src/voice/measure.ts';
import type { Catalog, VoiceFile } from '../src/data/types.ts';
import type { FeatureKey } from '../src/voice/features.ts';
import { evaluate, fitModel, itemStats, likenessScale, SELECT, selectWindows, type Speaker } from './lib.ts';
import { readXlsx } from './xlsx.ts';
import { sheetWindows, snapshotFromSheet } from './operator-voices-lib.ts';

const root = join(import.meta.dirname, '..');
const sheetAt = process.argv.indexOf('--sheet');
const speakers: Speaker[] = [];
if (sheetAt >= 0) {
  const path = process.argv[sheetAt + 1];
  if (!path || !existsSync(path)) {
    console.error('使い方: node tools/eval.ts --sheet <ダウンロードした xlsx>');
    process.exit(2);
  }
  const snap = snapshotFromSheet(readXlsx(readFileSync(path)), MEASURE_VERSION);
  for (const [id, { kept }] of [...sheetWindows(snap)].sort(([a], [b]) => (a < b ? -1 : 1))) if (kept.length >= SELECT.minWindows) speakers.push({ id, windows: kept });
} else {
  const list = JSON.parse(readFileSync(join(root, 'data/catalog.json'), 'utf8')) as Catalog;
  const known = new Set(list.voices.map((v) => v.id));
  const dir = join(root, 'data/voices');
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const file = JSON.parse(readFileSync(join(dir, name), 'utf8')) as VoiceFile;
    if (!known.has(file.id)) continue;
    const { kept } = selectWindows(file.windows, MEASURE_VERSION);
    if (kept.length >= SELECT.minWindows) speakers.push({ id: file.id, windows: kept });
  }
}
if (speakers.length < 3) {
  console.log(`使える人が ${speakers.length} 人です（3 人以上いります）。モデルは作りません。`);
  process.exit(0);
}
const channelPath = join(root, 'data/channel.json');
const channel = existsSync(channelPath) ? (JSON.parse(readFileSync(channelPath, 'utf8')) as Partial<Record<FeatureKey, number>>) : undefined;
const items = itemStats(speakers);
/** 2 つの作り方（項目ごとの散らばりだけ・白色化）を評価して、1 位の割合がよい方 */
function choose(ch: Partial<Record<FeatureKey, number>> | undefined) {
  const rd = evaluate(speakers, (train) => fitModel(train, MEASURE_VERSION, { whiten: false, channel: ch }));
  const rw = evaluate(speakers, (train) => fitModel(train, MEASURE_VERSION, { whiten: true, channel: ch }));
  const fitted = fitModel(speakers, MEASURE_VERSION, { whiten: rw.top1 > rd.top1, channel: ch });
  const best = { ...fitted, likeness: likenessScale(speakers, fitted) };
  return { best, rd, rw };
}
const clean = choose(channel);
const best = clean.best;
const rd = clean.rd;
const rw = clean.rw;
writeFileSync(join(root, 'data/model.json'), JSON.stringify(best, null, 1) + '\n');
const report = {
  measureVersion: MEASURE_VERSION,
  speakers: speakers.length,
  windows: speakers.reduce((a, s) => a + s.windows.length, 0),
  diagonal: rd,
  whiten: rw,
  chosen: best.version,
  likeness: best.likeness,
  items: items.map((i) => ({ key: i.key, icc: Math.round(i.icc * 1000) / 1000 })),
};
writeFileSync(join(root, 'data/eval-report.json'), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ speakers: report.speakers, windows: report.windows, diagonal: rd, whiten: rw, chosen: best.version, likeness: best.likeness }));
