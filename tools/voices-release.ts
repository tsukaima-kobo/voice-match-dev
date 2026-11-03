// 運営が測った声の代表値（1 人 1 件）を作り、GitHub の Release「voices-data」に置く。
// リポジトリにはコミットしない（消すお願いの後に、GitHub の記録に名前と数字を残さないため）。
// サイトを作る時（.github/workflows/site.yml）に、Release から data/generated/ へ取ってきてページに入れる。
// 使い方:
//   node tools/voices-release.ts make --sheet <シートをダウンロードした.xlsx> --only <出す人の一覧.txt>
//   node tools/voices-release.ts make --sheet <シートをダウンロードした.xlsx> --all
//     （--sheet の代わりに、収集の書き出し --snapshot <snapshot.json> も使える）
//     → data/generated/operator-voices.json を作る（手元の npx vite でも、この声が出る）。音は入らない。
//   node tools/voices-release.ts upload --yes
//     → 作ったファイルを Release に置き（Release が無ければ作る）、サイトを作り直す。gh（GitHub CLI）を使う。
//       公開になるので、運営が決めてから。--yes が無い時は、置く物を見せるだけで何もしない。
// 知らないオプションがあれば、何もしないで止まる。
// 出す人の一覧: 1 行に 1 人の人物ID。# から後は無視。手順は docs/voices-release.md。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEASURE_VERSION } from '../src/voice/measure.ts';
import type { OperatorVoices } from '../src/data/types.ts';
import { buildOperatorVoices, parseIdList, snapshotFromSheet, type Snapshot } from './operator-voices-lib.ts';
import { readXlsx } from './xlsx.ts';

export const RELEASE_TAG = 'voices-data';
const root = join(import.meta.dirname, '..');
const out = join(root, 'data', 'generated', 'operator-voices.json');
const args = process.argv.slice(2);
const opt = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const USAGE = '使い方: node tools/voices-release.ts make (--sheet <シート.xlsx> | --snapshot <snapshot.json>) (--only <出す人の一覧.txt> | --all) ／ upload --yes（くわしくは docs/voices-release.md）';
// (anything unknown, such as --help, stops here before anything is made or sent)
const ALLOWED: Record<string, { flags: string[]; values: string[] }> = { make: { flags: ['--all'], values: ['--sheet', '--snapshot', '--only'] }, upload: { flags: ['--yes'], values: [] } };
const allowed = ALLOWED[args[0] ?? ''];
const unknown = !allowed || args.slice(1).some((a, i, rest) => !(allowed.flags.includes(a) || allowed.values.includes(a) || allowed.values.includes(rest[i - 1] ?? '')));
if (unknown) {
  console.error(USAGE);
  process.exit(2);
}

if (args[0] === 'make') {
  const sheetPath = opt('--sheet');
  const snapPath = opt('--snapshot');
  const onlyPath = opt('--only');
  if (!sheetPath === !snapPath || (!onlyPath && !args.includes('--all'))) {
    console.error(USAGE);
    process.exit(2);
  }
  const snap = sheetPath ? snapshotFromSheet(readXlsx(readFileSync(sheetPath)), MEASURE_VERSION) : (JSON.parse(readFileSync(snapPath!, 'utf8')) as Snapshot);
  if (sheetPath) console.log(`シート: 人物 ${snap.peoples.length} 行・測定値 ${snap.measurements.length} 行（シートには測り方の版が無いので、45 項目の見出しが今と同じことで確かめ、版 ${MEASURE_VERSION} として扱います）`);
  const only = onlyPath ? parseIdList(readFileSync(onlyPath, 'utf8')) : null;
  const { file, notes } = buildOperatorVoices(snap, { measureVersion: MEASURE_VERSION, only });
  for (const n of notes) console.log(n);
  mkdirSync(join(root, 'data', 'generated'), { recursive: true });
  writeFileSync(out, JSON.stringify(file, null, 1) + '\n');
  console.log(`data/generated/operator-voices.json: ${file.voices.length} 人（測り方の版 ${file.measureVersion}）`);
} else if (args[0] === 'upload') {
  if (!existsSync(out)) {
    console.error('先に make で data/generated/operator-voices.json を作ってください。');
    process.exit(2);
  }
  const file = JSON.parse(readFileSync(out, 'utf8')) as OperatorVoices;
  if (file.version !== 1 || file.measureVersion !== MEASURE_VERSION || !Array.isArray(file.voices)) {
    console.error(`ファイルの形か測り方の版が違います（今のサイト: ${MEASURE_VERSION}）。make で作り直してください。`);
    process.exit(2);
  }
  if (!args.includes('--yes')) {
    console.log(`置く物: data/generated/operator-voices.json（${file.voices.length} 人: ${file.voices.map((v) => v.name).join('・')}）`);
    console.log(`Release「${RELEASE_TAG}」に置くと公開になります。決めてから --yes を付けて動かしてください。何もしていません。`);
    process.exit(0);
  }
  const gh = (...a: string[]) => execFileSync('gh', a, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  const tags = gh('release', 'list', '--limit', '200', '--json', 'tagName', '-q', '.[].tagName').split('\n');
  if (!tags.includes(RELEASE_TAG)) {
    gh('release', 'create', RELEASE_TAG, '--title', '声のデータ（運営が測った声）', '--notes', 'サイトを作る時に読む、運営が測った声の代表値です（名前・所属・公式ページ・数字）。音は入っていません。tools/voices-release.ts が置きます。', '--latest=false');
    console.log(`Release「${RELEASE_TAG}」を作りました。`);
  }
  gh('release', 'upload', RELEASE_TAG, out, '--clobber');
  console.log(`Release「${RELEASE_TAG}」に operator-voices.json（${file.voices.length} 人）を置きました。`);
  gh('workflow', 'run', 'site.yml');
  console.log('サイトの作り直しを始めました（数分で公開ページに出ます）。');
}
