// data/voices/<id>.json（拡張機能が書き出した窓）から、data/profiles.json（お手本の声ごとの代表値）を作る。
// 使い方: node tools/build-voices.ts
// 窓の選別は tools/lib.ts の SELECT。窓が SELECT.minWindows に届かない人は入れない。
// data/catalog.json に無い ID の声は入れない（削除の依頼があった声は、catalog.json と voices/ から消す）。
// 測り方の版は、使った窓の中でいちばん古い版を書く（今の版と、比べてよい前の版 MEASURE_COMPATIBLE が混ざることがある）。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEASURE_VERSION } from '../src/voice/measure.ts';
import type { Catalog, ProfileEntry, ProfileList, VoiceFile } from '../src/data/types.ts';
import { medianFeatures, SELECT, selectWindows } from './lib.ts';
import { oldestVersion } from './versions.ts';

const root = join(import.meta.dirname, '..');
const list = JSON.parse(readFileSync(join(root, 'data/catalog.json'), 'utf8')) as Catalog;
const known = new Set(list.voices.map((v) => v.id));
const dir = join(root, 'data/voices');
const profiles: ProfileEntry[] = [];
for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const file = JSON.parse(readFileSync(join(dir, name), 'utf8')) as VoiceFile;
  if (!known.has(file.id)) {
    console.log(`${file.id}: data/catalog.json に無いので入れません`);
    continue;
  }
  const { kept, dropped } = selectWindows(file.windows, MEASURE_VERSION);
  const videos = new Set(kept.map((w) => w.video)).size;
  const note = `窓 ${file.windows.length} → 使う ${kept.length}（除いた: 版 ${dropped.version}・音楽 ${dropped.music}・声が少ない ${dropped.short}・高さが外れる ${dropped.pitch}）、動画 ${videos} 本`;
  if (kept.length < SELECT.minWindows) {
    console.log(`${file.id}: ${note} → 窓が ${SELECT.minWindows} に足りないので入れません`);
    continue;
  }
  console.log(`${file.id}: ${note}`);
  profiles.push({ id: file.id, version: oldestVersion(kept.map((w) => w.version), MEASURE_VERSION), windows: kept.length, videos, features: medianFeatures(kept) });
}
profiles.sort((a, b) => (a.id < b.id ? -1 : 1));
const out: ProfileList = { version: oldestVersion(profiles.map((p) => p.version), MEASURE_VERSION), profiles };
writeFileSync(join(root, 'data/profiles.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`data/profiles.json: ${profiles.length} 件`);
