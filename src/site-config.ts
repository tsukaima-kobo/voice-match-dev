// サイトの外へのリンクと、共有の設定。ここ 1 か所だけを書き換える。
// - url: 公開の住所（X の投稿・OGP に入れる）。ビルドの時に VITE_SITE_URL で上書きできる（本番のリポジトリで使う）。
// - maker: 作った人（使い魔工房）のリンク。https:// で始まる物だけが出る。新しいタブで開く。
// - github: GitHub のリポジトリ（"owner/name"）。空の間は、スターの導線を一つも出さない（本番のリリースまで空にしておく）。
export type MakerLinkId = 'x' | 'youtube' | 'note' | 'zenn' | 'qiita';

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

export const SITE = {
  url: env.VITE_SITE_URL || 'https://tsukaima-kobo.github.io/voice-twin-dev/',
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
  /** 例: "tsukaima-kobo/voice-twin"。本番のリリースまで空（スターの導線を出さない） */
  github: '',
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
