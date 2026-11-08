// 運営が測った声の代表値（1 人 1 件）を作り、GitHub の Release「voices-data」に置く。
// リポジトリにはコミットしない（消すお願いの後に、GitHub の記録に名前と数字を残さないため）。
// サイトを作る時（.github/workflows/site.yml）に、Release から data/generated/ へ取ってきてページに入れる。
// 使い方:
//   node tools/voices-release.ts make --sheet <シートをダウンロードした.xlsx> --only <出す人の一覧.txt>
//   node tools/voices-release.ts make --sheet <シートをダウンロードした.xlsx> --all
//     （--sheet の代わりに、収集の書き出し --snapshot <snapshot.json> も使える）
//     → data/generated/operator-voices.json を作る（手元の npx vite でも、この声が出る）。音は入らない。
//       サイトで同じ名前として 1 人しか出ない人がいれば、最後に「注意」として名前を出す（この記録は手元だけ。サイトのビルドの記録には人数だけ）。
//   node tools/voices-release.ts upload --repo <owner/name> --yes
//     → 作ったファイルを、--repo のリポジトリの Release に置き（Release が無ければ作る）、そのサイトを作り直す。gh（GitHub CLI）を使う。
//       --repo は必ず書く（決まった物は無い。手元の gh の設定や GH_REPO で、思っていないリポジトリに置かないため）。
//       書けるのは本番（tsukaima-kobo/voice-match）と検証用（tsukaima-kobo/voice-match-dev）だけ。
//       公開になるので、運営が決めてから。--yes が無い時は、置く物と置き先を見せるだけで何もしない。
// 知らないオプションがあれば、何もしないで止まる。
// 出す人の一覧: 1 行に 1 人の人物ID。# から後は無視。手順は docs/voices-release.md。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEASURE_VERSION, readableVersion } from '../src/voice/measure.ts';
import type { OperatorVoices } from '../src/data/types.ts';
import { buildOperatorVoices, parseIdList, snapshotFromSheet, type Snapshot } from './operator-voices-lib.ts';
import { KINDS, parseKinds } from '../src/data/kinds.ts';
import { fromOperatorVoices, mergeVoices } from '../src/data/sources.ts';
import { readXlsx } from './xlsx.ts';
import { DEV, PRODUCTION } from '../src/site-config.ts';

export const RELEASE_TAG = 'voices-data';
const root = join(import.meta.dirname, '..');
const out = join(root, 'data', 'generated', 'operator-voices.json');
const args = process.argv.slice(2);
const opt = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const USAGE = `使い方: node tools/voices-release.ts make (--sheet <シート.xlsx> | --snapshot <snapshot.json>) (--only <出す人の一覧.txt> | --all) [--kind <大枠>] ／ upload --repo (${PRODUCTION.repo} | ${DEV.repo}) --yes（くわしくは docs/voices-release.md）`;
// 知らない物（--help など）があれば、何かを作ったり送ったりする前に、ここで止まる
const ALLOWED: Record<string, { flags: string[]; values: string[] }> = { make: { flags: ['--all'], values: ['--sheet', '--snapshot', '--only', '--kind'] }, upload: { flags: ['--yes'], values: ['--repo'] } };
/** 置いてよいリポジトリ（--repo の大文字・小文字は区別しない） */
const REPOS = [
  { repo: PRODUCTION.repo, label: `${PRODUCTION.repo}（本番・${PRODUCTION.url}）` },
  { repo: DEV.repo, label: `${DEV.repo}（検証用）` },
];
/** サイトにまとめた時に出ない人（同じ名前・名前が無い）を、名前つきで大きく知らせる（手元の記録だけ） */
function warnDropped(file: OperatorVoices, warnings: readonly string[] = []): void {
  const { dropped } = mergeVoices([fromOperatorVoices(file)], MEASURE_VERSION);
  if (!dropped.length && !warnings.length) return;
  console.log('==== 注意 ====');
  for (const w of warnings) console.log(w);
  if (dropped.length) console.log(`サイトに出ない人: ${dropped.length} 人（${dropped.map((d) => `「${d.name}${d.nameEn ? ` / ${d.nameEn}` : ''}」${d.reason === 'same' ? '前の人と同じ名前' : '名前が無い'}`).join('・')}）`);
  console.log('==============');
}

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
  if (sheetPath) console.log(`シート: 人物 ${snap.peoples.length} 行・測定値 ${snap.measurements.length} 行（45 項目の見出しが今と同じことを確かめた。版の列が無い行は 3.1.0 として読み、今の版 ${MEASURE_VERSION} と比べてよい版だけを使う）`);
  const only = onlyPath ? parseIdList(readFileSync(onlyPath, 'utf8')) : null;
  // --kind: 「大枠」のセルが空の人に付ける大枠（例: --kind VTuber）
  const kindText = opt('--kind');
  const kind = kindText ? parseKinds(kindText) : { mask: 0, unknown: [] };
  if (kindText && (kind.unknown.length || !kind.mask)) {
    console.error(`--kind の大枠が読めません: ${kind.unknown.join('・') || kindText}（使える物: ${KINDS.map((k) => k.ja).join('・')}）`);
    process.exit(2);
  }
  const { file, notes, warnings } = buildOperatorVoices(snap, { measureVersion: MEASURE_VERSION, only, defaultKinds: kind.mask });
  for (const n of notes) console.log(n);
  mkdirSync(join(root, 'data', 'generated'), { recursive: true });
  writeFileSync(out, JSON.stringify(file, null, 1) + '\n');
  const byKind = KINDS.map((k) => [k.ja, file.voices.filter((v) => v.kinds?.includes(k.id)).length] as const).filter(([, n]) => n > 0);
  const none = file.voices.filter((v) => !v.kinds?.length).length;
  console.log(`data/generated/operator-voices.json: ${file.voices.length} 人（測り方の版 ${file.measureVersion}。使った窓の中でいちばん古い版）。大枠: ${byKind.map(([k, n]) => `${k} ${n}`).join('・') || 'なし'}${none ? `・大枠なし ${none}` : ''}`);
  warnDropped(file, warnings);
} else if (args[0] === 'upload') {
  const repoArg = (opt('--repo') ?? '').trim();
  const target = REPOS.find((r) => r.repo.toLowerCase() === repoArg.toLowerCase());
  if (!target) {
    console.error(`置き先のリポジトリを --repo で書いてください（決まった物はありません）。書けるのは ${REPOS.map((r) => r.label).join('・')} だけです。${repoArg ? `「${repoArg}」には置けません。` : ''}`);
    process.exit(2);
  }
  const { repo } = target;
  console.log(`==== 置き先: ${target.label} ====`);
  if (!existsSync(out)) {
    console.error('先に make で data/generated/operator-voices.json を作ってください。');
    process.exit(2);
  }
  const file = JSON.parse(readFileSync(out, 'utf8')) as OperatorVoices;
  if (file.version !== 1 || !readableVersion(file.measureVersion) || !Array.isArray(file.voices)) {
    console.error(`ファイルの形か測り方の版が違います（今のサイト: ${MEASURE_VERSION}）。make で作り直してください。`);
    process.exit(2);
  }
  if (!args.includes('--yes')) {
    console.log(`置く物: data/generated/operator-voices.json（${file.voices.length} 人: ${file.voices.map((v) => v.name).join('・')}）`);
    warnDropped(file);
    console.log(`Release「${RELEASE_TAG}」に置くと公開になります。決めてから --yes を付けて動かしてください。何もしていません。`);
    process.exit(0);
  }
  // どの gh にも --repo を付ける（手元の gh の設定や GH_REPO ではなく、ここで書いたリポジトリに置く）
  const gh = (...a: string[]) => execFileSync('gh', [...a, '--repo', repo], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  const notes = 'サイトを作る時に読む、運営が測った声の代表値です（名前・英語名・所属・所属の英語名・大枠・公式ページ・数字。英語名は書いてある人だけ）。音は入っていません。tools/voices-release.ts が置きます。';
  // Release があるか（数が多くても見落とさないよう、名前で 1 つだけ見る。無い時の gh は「release not found」で終わる）
  let exists = true;
  try {
    execFileSync('gh', ['release', 'view', RELEASE_TAG, '--json', 'tagName', '--repo', repo], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = String((e as { stderr?: Buffer }).stderr ?? '');
    if (!/not found/i.test(err)) {
      console.error(`Release「${RELEASE_TAG}」があるか確かめられませんでした: ${err.trim() || (e as Error).message}`);
      process.exit(1);
    }
    exists = false;
  }
  if (!exists) {
    gh('release', 'create', RELEASE_TAG, '--title', '声のデータ（運営が測った声）', '--notes', notes, '--latest=false');
    console.log(`Release「${RELEASE_TAG}」を作りました。`);
  } else gh('release', 'edit', RELEASE_TAG, '--notes', notes);
  gh('release', 'upload', RELEASE_TAG, out, '--clobber');
  console.log(`${repo} の Release「${RELEASE_TAG}」に operator-voices.json（${file.voices.length} 人）を置きました。`);
  gh('workflow', 'run', 'site.yml');
  console.log(`${repo} のサイトの作り直しを始めました（数分で公開ページに出ます）。`);
}
