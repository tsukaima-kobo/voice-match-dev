// 声の登録を取り込む: フォームの回答（Google スプレッドシート、または手で書き出した CSV）から、
// 壁 ①（もう一度）・壁 ②（dots の判定が OK の行だけ）・壁 ③（3 件以上そろったら）を通った声を data/ に書く。
// 使い方:
//   node tools/intake.ts --csv 回答.csv     手で書き出した CSV から（運営の手元で）
//   node tools/intake.ts --sheet            GitHub Actions から（環境変数 GOOGLE_SA_KEY・SHEET_ID・SHEET_RANGE）
// 書く物: data/submissions.json（壁 ①② を通った登録）、data/user-catalog.json・user-profiles.json（壁 ③ を通った声）、
//         data/user-ids.json（名前ごとの ID。一度決めたら変えない）。
// 読む物: data/blocklist.json（削除のお願いがあった名前）、data/ng-words.json（禁止の言葉）、data/model.json（照合のモデル）。
// 毎回、回答の全部から作り直す（同じ回答なら同じ結果）。送った人の情報は、回答にも data/ にも入らない。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEASURE_VERSION } from '../src/voice/measure.ts';
import { defaultModel, type MatchModel } from '../src/match/match.ts';
import type { Catalog, ProfileList } from '../src/data/types.ts';
import { featureArray, intake, rowsFromTable } from './intake-lib.ts';
import { parseCsv } from './csv.ts';
import { readSheet } from './sheets.ts';

const root = join(import.meta.dirname, '..');
const read = <T>(name: string): T => JSON.parse(readFileSync(join(root, 'data', name), 'utf8')) as T;
const write = (name: string, value: unknown) => writeFileSync(join(root, 'data', name), JSON.stringify(value, null, 1) + '\n');

const args = process.argv.slice(2);
let table: string[][];
if (args[0] === '--csv' && args[1]) table = parseCsv(readFileSync(args[1], 'utf8'));
else if (args[0] === '--sheet') {
  const { GOOGLE_SA_KEY, SHEET_ID, SHEET_RANGE } = process.env;
  if (!GOOGLE_SA_KEY || !SHEET_ID) {
    console.log('GOOGLE_SA_KEY と SHEET_ID がまだ設定されていません。取り込みは飛ばします。');
    process.exit(0);
  }
  table = await readSheet(GOOGLE_SA_KEY, SHEET_ID, SHEET_RANGE || 'A:D');
} else {
  console.log('使い方: node tools/intake.ts --csv 回答.csv  または  node tools/intake.ts --sheet');
  process.exit(1);
}

const m = read<Partial<MatchModel> & { version: string }>('model.json');
const model: MatchModel = m.version !== 'none' && m.measureVersion === MEASURE_VERSION && Array.isArray(m.keys) ? (m as MatchModel) : defaultModel(MEASURE_VERSION);
const r = intake(rowsFromTable(table), {
  model,
  ngWords: read<{ words: string[] }>('ng-words.json').words,
  blocked: read<{ names: string[] }>('blocklist.json').names,
  ids: read<Record<string, string>>('user-ids.json'),
});

write('submissions.json', { version: 1, measureVersion: MEASURE_VERSION, submissions: r.accepted.map((a) => ({ ...a, features: featureArray(a.features) })) });
const catalog: Catalog = { version: 1, voices: r.voices.map((v) => ({ id: v.id, name: v.name, ...(v.group ? { group: v.group } : {}), links: { profile: v.link }, by: 'users' as const })) };
write('user-catalog.json', catalog);
const profiles: ProfileList = { version: MEASURE_VERSION, profiles: r.voices.map((v) => ({ id: v.id, version: MEASURE_VERSION, windows: v.used, videos: 0, features: v.features })) };
write('user-profiles.json', profiles);
write('user-ids.json', r.ids);

const c = r.counts;
console.log(`回答 ${c.rows} 件: 判定待ち ${c.pending}・dots が NG ${c.judgedNg}・読めない ${c.unreadable}・壁① ${c.wall1}・禁止の言葉 ${c.ngWord}・削除済み ${c.blocked}・1 日の上限 ${c.overDay}・名前ごとの上限 ${c.overName}・同じ数字 ${c.duplicate} → 受け付け ${c.accepted}`);
console.log(`壁③ を通った声: ${r.voices.length} 件（${r.voices.map((v) => `${v.id} ${v.name}（${v.used} 件）`).join('、') || 'まだ無し'}）`);
