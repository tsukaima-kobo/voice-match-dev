// サイトのビルド（GitHub Pages 用。どの住所の下に置いても動くよう base は './'）。
// ビルドした HTML には CSP を入れ、外への通信（fetch など）と外の物の読み込みを止める。
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { MEASURE_VERSION } from './src/voice/measure.ts';
import { packVoices } from './src/data/pack.ts';
import { fromOperatorVoices, mergeVoices } from './src/data/sources.ts';
import type { Catalog, OperatorVoices, ProfileList } from './src/data/types.ts';

const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "connect-src 'none'", "font-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');

const csp = (): Plugin => ({
  name: 'voice-twin-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// SNS で共有された時の見た目（OGP・X のカード）。住所は絶対の物が要るので、公開の住所（VITE_SITE_URL、無ければ検証用）から作る。
// 画像は public/og.jpg（1200×630）。ページごとに題と説明を入れる。
const SITE_URL = (process.env.VITE_SITE_URL || 'https://tsukaima-kobo.github.io/voice-match-dev/').replace(/\/?$/, '/');
const OG: Record<string, { title: string; description: string }> = {
  'index.html': { title: 'voice-match｜あなたの声は誰に近い？', description: '一言話すと、声を 45 項目で測って、近い声と、あなただけの声紋を出します。登録不要・音は送らない。Say a phrase and see whose voice is closest to yours, plus your own voiceprint.' },
  'mimic.html': { title: '声真似の点数｜voice-match', description: 'お手本のセリフを真似すると、抑揚・タイミング・声の質で点数と直し方を出します。Imitate a line and get a score with tips.' },
  'about.html': { title: 'しくみと約束｜voice-match', description: '声をどう測り、どう比べるか。音を送らない・残さない約束。How voice-match measures voices, and our promises.' },
};
const ogp = (): Plugin => ({
  name: 'voice-twin-ogp',
  transformIndexHtml(html, ctx) {
    const page = ctx.filename.split('/').pop() ?? 'index.html';
    const o = OG[page] ?? OG['index.html']!;
    const url = page === 'index.html' ? SITE_URL : SITE_URL + page;
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const tags = [
      ['og:type', 'website'],
      ['og:site_name', 'voice-match'],
      ['og:title', o.title],
      ['og:description', o.description],
      ['og:url', url],
      ['og:image', `${SITE_URL}og.jpg`],
      ['og:image:width', '1200'],
      ['og:image:height', '630'],
      ['og:locale', 'ja_JP'],
      ['og:locale:alternate', 'en_US'],
    ]
      .map(([k, v]) => `<meta property="${k}" content="${esc(v!)}" />`)
      .concat([`<meta name="twitter:card" content="summary_large_image" />`, `<meta name="twitter:image" content="${esc(`${SITE_URL}og.jpg`)}" />`]);
    return html.replace('</title>', `</title>\n    ${tags.join('\n    ')}`);
  },
});

// 声のデータ（名前・リンク・数字）を詰めて、ページとは別のファイルにする（src/data/pack.ts）。ページはすぐ出て、データは裏で読む。
// 元: 運営が測った声（data/generated/operator-voices.json。GitHub の Release から、サイトを作る時だけ取ってくる）、
// 拡張機能で測った声（data/catalog.json・profiles.json）、登録から出した声（data/generated/user-*.json）。まとめ方は src/data/sources.ts。
const VOICE_PACK = 'virtual:voice-pack';
const voicePack = (): Plugin => ({
  name: 'voice-twin-voice-pack',
  resolveId: (id) => (id === VOICE_PACK ? `\0${VOICE_PACK}` : undefined),
  load(id) {
    if (id !== `\0${VOICE_PACK}`) return undefined;
    const read = <T>(path: string, empty: T): T => {
      const file = fileURLToPath(new URL(path, import.meta.url));
      if (!existsSync(file)) return empty;
      this.addWatchFile(file);
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    };
    const noCatalog: Catalog = { version: 1, voices: [] };
    const noProfiles: ProfileList = { version: MEASURE_VERSION, profiles: [] };
    const noOperator: OperatorVoices = { version: 1, measureVersion: MEASURE_VERSION, voices: [] };
    const { voices, features } = mergeVoices(
      [
        fromOperatorVoices(read('./data/generated/operator-voices.json', noOperator)),
        { voices: read('./data/catalog.json', noCatalog).voices, profiles: read('./data/profiles.json', noProfiles).profiles },
        { voices: read('./data/generated/user-catalog.json', noCatalog).voices, profiles: read('./data/generated/user-profiles.json', noProfiles).profiles },
      ],
      MEASURE_VERSION,
    );
    return `export default ${JSON.stringify(packVoices(MEASURE_VERSION, voices, features))};`;
  },
});

export default defineConfig({
  base: './',
  plugins: [csp(), ogp(), voicePack()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        about: fileURLToPath(new URL('./about.html', import.meta.url)),
        mimic: fileURLToPath(new URL('./mimic.html', import.meta.url)),
        measure: fileURLToPath(new URL('./measure.html', import.meta.url)),
      },
    },
  },
});
