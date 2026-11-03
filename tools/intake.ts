// 声の登録を取り込む: フォームの回答（Google スプレッドシート、または手で書き出した CSV）から、
// 壁 ①（もう一度）・壁 ②（dots の判定が OK の行だけ）・壁 ③（3 件以上そろったら）を通った声を作る。
// 登録の元はスプレッドシートだけに置く（運営だけが見られる）。ここで作る物はリポジトリに入れず（.gitignore）、
// サイトを作る時だけ使う（GitHub Actions の build。公開ページには、出すと決まった声の名前・リンク・数字だけが載る）。
// 使い方:
//   node tools/intake.ts --sheet            GitHub Actions から（環境変数 GOOGLE_SA_KEY・SHEET_ID、任意で SHEET_RANGE・BLOCK_RANGE・NG_RANGE）
//   node tools/intake.ts --csv 回答.csv     手で書き出した CSV から（運営の手元で試す時）
// 書く物: data/generated/user-catalog.json・user-profiles.json（壁 ③ を通った声）。
// 読む物: スプレッドシートの回答・「削除」のタブ（削除のお願いがあった名前）・「禁止の言葉」のタブ、data/model.json（照合のモデル）。
// 毎回、回答の全部から作り直す（同じ回答なら同じ結果）。声の ID は名前から決まる（intake-lib.ts の userIdOf）。
// 記録（Actions のログは公開される）には件数だけを出し、名前は出さない。読めなかった時は誤りで止める（サイトを公開しない）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEASURE_VERSION } from '../src/voice/measure.ts';
import { defaultModel, type MatchModel } from '../src/match/match.ts';
import type { Catalog, ProfileList } from '../src/data/types.ts';
import { intake, rowsFromTable } from './intake-lib.ts';
import { parseCsv } from './csv.ts';
import { openSheet } from './sheets.ts';

const root = join(import.meta.dirname, '..');
const out = join(root, 'data', 'generated');
const write = (name: string, value: unknown) => writeFileSync(join(out, name), JSON.stringify(value, null, 1) + '\n');
/** 1 列目の、空でない文字（見出しの行は除く） */
const firstColumn = (t: string[][], header: string) => t.map((r) => (r[0] ?? '').trim()).filter((v) => v && v !== header);

const args = process.argv.slice(2);
let table: string[][];
let blocked: string[] = [];
let ngWords: string[] = [];
if (args[0] === '--csv' && args[1]) {
  table = parseCsv(readFileSync(args[1], 'utf8'));
  // (by hand: the removal list and the banned words as CSV files beside it, if given)
  const opt = (flag: string) => {
    const i = args.indexOf(flag);
    return i > 0 && args[i + 1] ? parseCsv(readFileSync(args[i + 1]!, 'utf8')) : [];
  };
  blocked = firstColumn(opt('--block'), '名前');
  ngWords = firstColumn(opt('--ng'), '言葉');
} else if (args[0] === '--sheet') {
  const { GOOGLE_SA_KEY, SHEET_ID, SHEET_RANGE, BLOCK_RANGE, NG_RANGE } = process.env;
  if (!GOOGLE_SA_KEY || !SHEET_ID) {
    console.log('GOOGLE_SA_KEY と SHEET_ID がまだ設定されていません。登録の声は入れずにサイトを作ります。');
    process.exit(0);
  }
  const sheet = await openSheet(GOOGLE_SA_KEY, SHEET_ID);
  table = await sheet.read(SHEET_RANGE || 'A:D');
  blocked = firstColumn(await sheet.readOptional(BLOCK_RANGE || '削除!A:A'), '名前');
  ngWords = firstColumn(await sheet.readOptional(NG_RANGE || '禁止の言葉!A:A'), '言葉');
} else {
  console.log('使い方: node tools/intake.ts --sheet  または  node tools/intake.ts --csv 回答.csv [--block 削除.csv] [--ng 禁止の言葉.csv]');
  process.exit(1);
}

const m = JSON.parse(readFileSync(join(root, 'data', 'model.json'), 'utf8')) as Partial<MatchModel> & { version: string };
const model: MatchModel = m.version !== 'none' && m.measureVersion === MEASURE_VERSION && Array.isArray(m.keys) ? (m as MatchModel) : defaultModel(MEASURE_VERSION);
const r = intake(rowsFromTable(table), { model, ngWords, blocked });

mkdirSync(out, { recursive: true });
const catalog: Catalog = { version: 1, voices: r.voices.map((v) => ({ id: v.id, name: v.name, ...(v.group ? { group: v.group } : {}), links: { profile: v.link } })) };
write('user-catalog.json', catalog);
const profiles: ProfileList = { version: MEASURE_VERSION, profiles: r.voices.map((v) => ({ id: v.id, version: MEASURE_VERSION, windows: v.used, videos: 0, features: v.features })) };
write('user-profiles.json', profiles);

const c = r.counts;
console.log(`回答 ${c.rows} 件: 判定待ち ${c.pending}・dots が NG ${c.judgedNg}・読めない ${c.unreadable}・壁① ${c.wall1}・禁止の言葉 ${c.ngWord}・削除済み ${c.blocked}・1 日の上限 ${c.overDay}・名前ごとの上限 ${c.overName}・同じ数字 ${c.duplicate} → 受け付け ${c.accepted}`);
console.log(`壁③ を通って、サイトに出す声: ${r.voices.length} 件`);
