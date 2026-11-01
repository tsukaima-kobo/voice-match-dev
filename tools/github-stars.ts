// GitHub のスターの数を、サイトを作る前に取ってきて data/generated/github.json に書く（GitHub Actions の build から）。
// site-config.ts の github が空の間は何もしない（本番のリリースまで）。取れなかった時は、数を出さないだけで止めない。
// 書く物はリポジトリに入れない（.gitignore の data/generated/）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE } from '../src/site-config.ts';

const repo = SITE.github;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.log('GitHub のリポジトリが設定されていません（site-config.ts の github）。スターの数は取りません。');
  process.exit(0);
}
const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'voice-twin-build' };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
try {
  const res = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const stars = ((await res.json()) as { stargazers_count?: number }).stargazers_count;
  if (typeof stars !== 'number') throw new Error('no count');
  const out = join(import.meta.dirname, '..', 'data', 'generated');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'github.json'), JSON.stringify({ stars }) + '\n');
  console.log(`スター ${stars}`);
} catch (e) {
  console.log(`スターの数を取れませんでした（${(e as Error).message}）。数は出しません。`);
}
