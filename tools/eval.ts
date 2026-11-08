// 照合のモデルを作り、見分ける力を測る。data/voices/ の窓から:
// 1. 項目ごとの再現性（ICC）
// 2. 2 つの作り方（項目ごとの散らばりだけ・白色化）で、1 本の動画を外して本人が 1 位・5 位以内に入る割合。
//    窓そのままと、一言にした窓（1 回に声 3 秒・8 秒が要る項目を除く）の両方。比べ方はサイトと同じ（src/match/match.ts）。
//    一言の割合は、残りの項目も 30 秒の窓から測った値のままなので、本当の一言より甘い
// 3. よい方を data/model.json に書き、結果を data/eval-report.json に書く。近さの言葉の目安（likeness。問いの種類ごと）もモデルに入れる
//    data/channel.json（マイクと配信の経路の差。tools/channel.ts）があれば、同じ人の中の揺れに足す。
// モデルの measureVersion は、使った窓の中でいちばん古い測り方の版（dataVersions に全部）。前の版を
// MEASURE_COMPATIBLE から外したら、そのモデルは使えなくなる（src/data/model-file.ts の modelProblem）。
// 使い方: node tools/eval.ts（data/voices/ の窓から）
//         node tools/eval.ts --sheet data/generated/<シート>.xlsx（運営が測った声の、スプレッドシートの窓から。tools/voices-release.ts と同じ窓を使う）
//         --force: 今のモデルより人がずっと少ない時（半分未満）や、シートから作ったモデルを --sheet なしで置き換える時も書く
// 評価で外した動画は、モデルを作るのにも使わない（外した動画ごとに作り直す）。
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEASURE_VERSION } from '../src/voice/measure.ts';
import type { Catalog, VoiceFile } from '../src/data/types.ts';
import type { FeatureKey } from '../src/voice/features.ts';
import type { MatchModel } from '../src/match/match.ts';
import { evaluate, fitModel, itemStats, likenessScale, replaceProblem, SELECT, selectWindows, type Speaker } from './lib.ts';
import { readXlsx } from './xlsx.ts';
import { sheetWindows, snapshotFromSheet } from './operator-voices-lib.ts';
import { compareVersions, oldestVersion } from './versions.ts';

const root = join(import.meta.dirname, '..');
const sheetAt = process.argv.indexOf('--sheet');
const force = process.argv.includes('--force');
const source: NonNullable<MatchModel['source']> = sheetAt >= 0 ? 'sheet' : 'voices';
const speakers: Speaker[] = [];
/** 使った窓の測り方の版 */
const versions = new Set<string>();
if (sheetAt >= 0) {
  const path = process.argv[sheetAt + 1];
  if (!path || !existsSync(path)) {
    console.error('使い方: node tools/eval.ts --sheet <ダウンロードした xlsx>');
    process.exit(2);
  }
  const snap = snapshotFromSheet(readXlsx(readFileSync(path)), MEASURE_VERSION);
  const fallback = oldestVersion(snap.summary?.measureVersions ?? [], MEASURE_VERSION);
  for (const [id, { kept }] of [...sheetWindows(snap)].sort(([a], [b]) => (a < b ? -1 : 1)))
    if (kept.length >= SELECT.minWindows) {
      speakers.push({ id, windows: kept });
      for (const w of kept) versions.add(w.version ?? fallback);
    }
} else {
  const list = JSON.parse(readFileSync(join(root, 'data/catalog.json'), 'utf8')) as Catalog;
  const known = new Set(list.voices.map((v) => v.id));
  const dir = join(root, 'data/voices');
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const file = JSON.parse(readFileSync(join(dir, name), 'utf8')) as VoiceFile;
    if (!known.has(file.id)) continue;
    const { kept } = selectWindows(file.windows, MEASURE_VERSION);
    if (kept.length >= SELECT.minWindows) {
      speakers.push({ id: file.id, windows: kept });
      for (const w of kept) versions.add(w.version);
    }
  }
}
if (speakers.length < 3) {
  console.log(`使える人が ${speakers.length} 人です（3 人以上いります）。モデルは作りません。`);
  process.exit(0);
}

// 今のモデルを、ずっと少ない人から作った物で置き換えない（--sheet を付け忘れた npm run eval など）
const modelPath = join(root, 'data/model.json');
const reportPath = join(root, 'data/eval-report.json');
if (!force && existsSync(modelPath)) {
  const now = JSON.parse(readFileSync(modelPath, 'utf8')) as Partial<MatchModel>;
  const report = existsSync(reportPath) ? (JSON.parse(readFileSync(reportPath, 'utf8')) as { speakers?: number }) : {};
  const why = replaceProblem(now, report.speakers, { speakers: speakers.length, source });
  if (why) {
    console.error(`書き換えませんでした: ${why}。シートから作り直す時は node tools/eval.ts --sheet data/generated/<シート>.xlsx、それでもこの声で置き換える時は --force を付けてください。`);
    process.exit(1);
  }
}

const dataVersions = [...versions].sort(compareVersions);
const measureVersion = oldestVersion(dataVersions, MEASURE_VERSION);
const channelPath = join(root, 'data/channel.json');
const channel = existsSync(channelPath) ? (JSON.parse(readFileSync(channelPath, 'utf8')) as Partial<Record<FeatureKey, number>>) : undefined;
const items = itemStats(speakers);
/** 2 つの作り方（項目ごとの散らばりだけ・白色化）を評価して、1 位の割合がよい方 */
function choose(ch: Partial<Record<FeatureKey, number>> | undefined) {
  const rd = evaluate(speakers, (train) => fitModel(train, measureVersion, { whiten: false, channel: ch }));
  const rw = evaluate(speakers, (train) => fitModel(train, measureVersion, { whiten: true, channel: ch }));
  const fitted = fitModel(speakers, measureVersion, { whiten: rw.top1 > rd.top1, channel: ch });
  const best = { ...fitted, dataVersions, source, likeness: likenessScale(speakers, fitted) };
  return { best, rd, rw };
}
const clean = choose(channel);
const best = clean.best;
const rd = clean.rd;
const rw = clean.rw;
writeFileSync(modelPath, JSON.stringify(best, null, 1) + '\n');
const report = {
  /** モデルの測り方の版（使った窓の中でいちばん古い版）と、使った窓の版の全部 */
  measureVersion,
  dataVersions,
  source,
  speakers: speakers.length,
  windows: speakers.reduce((a, s) => a + s.windows.length, 0),
  diagonal: rd,
  whiten: rw,
  oneLineNote: '一言（oneLine）は、30 秒の窓から 1 回に声 3 秒・8 秒が要る項目を除いて比べた物。残りの項目も 30 秒から測った値なので、本当の一言より当たりやすい（甘い数字）',
  chosen: best.version,
  likeness: best.likeness,
  items: items.map((i) => ({ key: i.key, icc: Math.round(i.icc * 1000) / 1000 })),
};
writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ speakers: report.speakers, windows: report.windows, measureVersion, dataVersions, diagonal: rd, whiten: rw, chosen: best.version, likeness: best.likeness }));
