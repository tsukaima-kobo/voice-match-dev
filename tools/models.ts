// 声真似練習場の「音楽を消す」に使う AI の部品を、public/models/ に用意する（リポジトリには入れない。.gitignore）。
// サイトを作る時（.github/workflows/site.yml）と、手元で試す時に `node tools/models.ts` で動かす。
//
// 1. Demucs（htdemucs。音楽を、声・ドラム・ベース・ほかに分ける。MIT）を、ブラウザーの WebGPU で動かせるよう 21 個に分けた物
//    （Hugging Face の monteslu/htdemucs-web-onnx。MIT）を、版（revision）を決めて取ってくる。1 つずつ SHA-256 を確かめ、
//    違えば止める（中身の分からない物を公開しない）。すでにあって同じ中身なら取り直さない。
// 2. onnxruntime-web（MIT）の WebGPU 用の WASM（node_modules の物）を 2 つに分けて置く。Cloudflare Pages は 1 つのファイルが
//    25 MiB まで（この WASM は約 28.7 MB）。ページは 2 つを読んでつなぎ、env.wasm.wasmBinary に渡す（src/voice/clean.worker.ts）。
// 3. public/models/models.json に、ファイルの名前・大きさ・Demucs の部品のつなぎ方を書く（ページはこれを読む）。
// 取ってくるのは、ここに書いた住所と版の物だけ。利用者の声などは、どこにも送らない（取るだけ）。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = `${ROOT}public/models/`;
/** Cloudflare Pages の 1 つのファイルの上限（25 MiB）より少し小さく */
const PART_MAX = 24 * 1024 * 1024;

const DEMUCS = {
  repo: 'monteslu/htdemucs-web-onnx',
  revision: 'a4a57cc0cf707e5b9a3e6ad3c2c4b21fcbe608c1',
  manifest: { file: 'htdemucs_split_manifest.json', sha256: '3b8f5089fa43b9483b816c837d69a955aeb8d0fb88bc8a0b57b778c1e9005768' },
  pieces: [
    'dc981b294afd05180890334d7a1994bd01af049c828634f5e9589c996baf9342',
    'a3dbe16bfa14cc438bc9906e7949658794d4df8a23260815d4ebc7bbaa0e2cba',
    '2dd65ec05b6d1b3eba32394b7c39c3081d7086542373a5011e01a414b4f8504e',
    'e306ad650ef8f41c34f5c68b0f25fbc2d9944ebecc810dddfd00e96f9370bf82',
    'b67b06ddbacdce6d25f3c2390018b1c3cac81124e85e99abeaab223b7a5ea4bd',
    '72800f59b4897a8d4768ae89a60712c24c3b35528348b6d3298a53cceed1df2a',
    '3a13a16ba15a5a6b1afb99597ab4dc72333d002d634964017244b46fec14be7d',
    '745602c473ea3887e483fd2ced4ed191356294c9591d0cf595c9cf048c81ebf1',
    '9885a20cd42090b0033c2dc9be4f236b15e930896d0040caf684f0600402e0a0',
    'c477f4ce84e2a936effab2a2c6260dba42a4062e02fddeb5f18afe1d2c757615',
    '56cc39a9bb812a5cd4daefe0a0d903dc7b752866d88694b4e7063dcf764a6060',
    '6bbb50b8afe31ea1dce6c9c2a5025d5dd35a05331841eeeade983ac443b21e09',
    '857583f4618a255f675cb146aef3276cf3aca682a0df34c05c2913ef6197ed50',
    'a72774f04ee131596066c9768f430f8671e85635a44b56972310e368a3a5f71b',
    '90542229d4662c01e428282838d1b39b840dfce7f2081a4ac5157e7b6fd3b6e3',
    'e46d3a24d84627ed85b13328a07e2717a9ddfdfb7fe8e318739d08db022b97c3',
    '1f4acdec85a277613cc7929d4f51601ce0a58bee5f77034f437192b7a8db0d66',
    '396a306a69ab388eb4b6773106c10862bb3249808109144c2d8e9b49c1d28988',
    '488d9cb2672cb1211a719a9170c76eef1cf1d278d832f8a756ce4cfa85836346',
    '331d197571f917b752416592b3cc776ede027a87258adf461d65bfd5753db327',
    'b7acdfcda80ca8d1f23768af12ec8b93d5b46d5f3918629859380ee5d864777e',
  ],
};

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** 決めた版のファイルを取る（あって中身が同じなら取らない）。中身が違えば止める */
async function fetchPinned(name: string, want: string, dir: string): Promise<Uint8Array> {
  const path = `${dir}${name}`;
  if (existsSync(path)) {
    const have = new Uint8Array(readFileSync(path));
    if (sha256(have) === want) return have;
  }
  const url = `https://huggingface.co/${DEMUCS.repo}/resolve/${DEMUCS.revision}/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name} を取れませんでした（HTTP ${res.status}）`);
  const got = new Uint8Array(await res.arrayBuffer());
  const hash = sha256(got);
  if (hash !== want) throw new Error(`${name} の中身が決めた物と違います（${hash}）。版を確かめるまで公開しません`);
  writeFileSync(path, got);
  return got;
}

async function main(): Promise<void> {
  const demucsDir = `${OUT}demucs-${DEMUCS.revision.slice(0, 8)}/`;
  mkdirSync(demucsDir, { recursive: true });
  const manifest = JSON.parse(new TextDecoder().decode(await fetchPinned(DEMUCS.manifest.file, DEMUCS.manifest.sha256, demucsDir))) as {
    pieces: { file: string; inputs: string[]; outputs: string[] }[];
    outputs: { freq: string; time: string };
  };
  if (manifest.pieces.length !== DEMUCS.pieces.length) throw new Error('Demucs の部品の数が、決めた物と違います');
  const pieces = [];
  for (const [i, p] of manifest.pieces.entries()) {
    const bytes = await fetchPinned(p.file, DEMUCS.pieces[i]!, demucsDir);
    if (bytes.length > PART_MAX) throw new Error(`${p.file} が ${PART_MAX} バイトより大きい（Cloudflare Pages に置けない）`);
    pieces.push({ file: `${demucsDir.slice(OUT.length)}${p.file}`, bytes: bytes.length, inputs: p.inputs, outputs: p.outputs });
  }

  // onnxruntime-web の WebGPU 用の WASM を、2 つ以上に分けて置く
  const ortPkg = JSON.parse(readFileSync(`${ROOT}node_modules/onnxruntime-web/package.json`, 'utf8')) as { version: string };
  const wasm = new Uint8Array(readFileSync(`${ROOT}node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm`));
  const ortDir = `${OUT}ort-${ortPkg.version}/`;
  mkdirSync(ortDir, { recursive: true });
  const n = Math.ceil(wasm.length / PART_MAX);
  const size = Math.ceil(wasm.length / n);
  const parts = [];
  for (let k = 0; k < n; k++) {
    const part = wasm.subarray(k * size, Math.min(wasm.length, (k + 1) * size));
    const file = `${ortDir}asyncify-${k}.bin`;
    if (!existsSync(file) || statSync(file).size !== part.length || sha256(new Uint8Array(readFileSync(file))) !== sha256(part)) writeFileSync(file, part);
    parts.push({ file: file.slice(OUT.length), bytes: part.length });
  }

  const index = {
    version: 1,
    demucs: { repo: DEMUCS.repo, revision: DEMUCS.revision, rate: 44100, outputs: manifest.outputs, pieces },
    ort: { version: ortPkg.version, sha256: sha256(wasm), parts },
  };
  writeFileSync(`${OUT}models.json`, `${JSON.stringify(index)}\n`);
  const mb = (b: number) => (b / 1e6).toFixed(1);
  console.log(`音楽を消す AI: Demucs ${pieces.length} 個 ${mb(pieces.reduce((s, p) => s + p.bytes, 0))} MB・onnxruntime-web ${ortPkg.version} の WASM ${parts.length} 個 ${mb(wasm.length)} MB → public/models/`);
}

await main();
