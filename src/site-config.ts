// サイトの外へのリンクと、共有の設定。ここ 1 か所だけを書き換える。
// - 本番か検証用か: GitHub Actions が VITE_REPO にリポジトリの名前を入れる。本番のリポジトリ（PRODUCTION.repo）で作った時だけ本番になり、
//   公開の住所・スターの導線・削除のお願いの Issue の行き先が本番の物になる。検証用は検索に出さない（vite.config.ts）。
// - url: 公開の住所（X の投稿・OGP に入れる）。VITE_SITE_URL があれば、住所だけそれにする。
// - maker: 作った人（使い魔工房）のリンク。https:// で始まる物だけが出る。新しいタブで開く。
// - github: GitHub のリポジトリ（"owner/name"）。空の時は、スターの導線を一つも出さない（検証用では空）。
// - removal: 削除のお願いの窓口（Google フォーム・メール・GitHub の Issue）。
export type MakerLinkId = 'x' | 'youtube' | 'note' | 'zenn' | 'qiita';

type Env = Record<string, string | undefined>;
/** サイトの中では Vite が入れる import.meta.env、ビルドの道具（node）では process.env */
const env: Env = (import.meta as { env?: Env }).env ?? (globalThis as { process?: { env: Env } }).process?.env ?? {};

/** 本番のリポジトリと公開の住所 */
export const PRODUCTION = { repo: 'tsukaima-kobo/voice-match', url: 'https://voice-match.com/' } as const;
/** 検証用のリポジトリと公開の住所 */
export const DEV = { repo: 'tsukaima-kobo/voice-match-dev', url: 'https://tsukaima-kobo.github.io/voice-match-dev/' } as const;

/** どちらのサイトを作るか（VITE_REPO が本番のリポジトリの時だけ本番。GitHub のリポジトリの名前と同じく、大文字・小文字は区別しない） */
export function siteFor(e: Env): { production: boolean; url: string; github: string; issues: string } {
  const production = (e.VITE_REPO ?? '').trim().toLowerCase() === PRODUCTION.repo.toLowerCase();
  const base = production ? PRODUCTION : DEV;
  return { production, url: e.VITE_SITE_URL || base.url, github: production ? PRODUCTION.repo : '', issues: base.repo };
}
const TARGET = siteFor(env);

export const SITE = {
  /** 本番のサイトか（検証用なら false） */
  production: TARGET.production,
  url: TARGET.url,
  /** X の投稿に付けるハッシュタグ（# は付けない） */
  hashtags: ['voicematch', '声真似練習場'],
  maker: {
    name: '使い魔工房',
    nameEn: 'Tsukaima Kobo',
    links: {
      x: 'https://x.com/tsukaima_kobo',
      youtube: 'https://www.youtube.com/@tsukaima_kobo',
      note: 'https://note.com/tsukaima_kobo',
      zenn: 'https://zenn.dev/tsukaima_kobo',
      qiita: 'https://qiita.com/tsukaima_kobo',
    } as Readonly<Record<MakerLinkId, string | null>>,
  },
  /** 本番では本番のリポジトリ、検証用では空（スターの導線を出さない） */
  github: TARGET.github,
  /** 削除のお願いの窓口（しくみと約束の 07）。issues は Issue を立てるリポジトリ（本番では本番、検証用では検証用） */
  removal: {
    form: 'https://docs.google.com/forms/d/e/1FAIpQLSeWtH6Ymeb1bNpSxf8iAe3JI5Qiq_AIDF3TuZgJM35KxaJoJg/viewform',
    email: 'contact@voice-match.com',
    issues: TARGET.issues,
  },
};

/** 出す順番と、サービスの名前 */
const LINK_NAMES: readonly (readonly [MakerLinkId, string])[] = [
  ['x', 'X'],
  ['youtube', 'YouTube'],
  ['note', 'note'],
  ['zenn', 'Zenn'],
  ['qiita', 'Qiita'],
];

/** 出すリンク: https:// で始まる、住所として読める物だけ */
export function makerLinks(links: Readonly<Record<MakerLinkId, string | null | undefined>> = SITE.maker.links): { id: MakerLinkId; name: string; url: string }[] {
  const out: { id: MakerLinkId; name: string; url: string }[] = [];
  for (const [id, name] of LINK_NAMES) {
    const url = links[id];
    if (typeof url !== 'string' || !url.startsWith('https://')) continue;
    try {
      if (!new URL(url).hostname) continue;
    } catch {
      continue;
    }
    out.push({ id, name, url });
  }
  return out;
}

/** GitHub のリポジトリの住所（設定が無ければ null） */
export function githubUrl(repo: string = SITE.github): string | null {
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}` : null;
}

/** X の投稿の画面の住所（文・住所・ハッシュタグを入れた状態で開く） */
export function xIntent(text: string, url: string = SITE.url, hashtags: readonly string[] = SITE.hashtags): string {
  const q = new URLSearchParams({ text, url });
  if (hashtags.length) q.set('hashtags', hashtags.join(','));
  return `https://x.com/intent/tweet?${q.toString()}`;
}
