// サイトの外へのリンク（site-config.ts）: 作った人のリンクは https:// の物だけ、GitHub は設定がある時だけ、X の投稿の住所。
import { describe, expect, it } from 'vitest';
import { DEV, githubUrl, makerLinks, PRODUCTION, siteFor, xIntent } from '../src/site-config.ts';

describe('外へのリンク', () => {
  it('作った人のリンクは、完全な https:// の物だけを、決まった順で出す', () => {
    expect(makerLinks({ x: 'https://x.com/a', youtube: 'http://youtube.com/b', note: null, zenn: 'javascript:alert(1)', qiita: 'https://qiita.com/c' }).map((l) => l.id)).toEqual(['x', 'qiita']);
    expect(makerLinks().map((l) => l.name)).toEqual(['X', 'YouTube', 'note', 'Zenn', 'Qiita']);
  });
  it('本番のリポジトリで作った時だけ、本番の住所・スターの導線・本番の Issue。ほかは検証用（スターを出さない）', () => {
    expect(siteFor({ VITE_REPO: PRODUCTION.repo })).toEqual({ production: true, url: PRODUCTION.url, github: PRODUCTION.repo, issues: PRODUCTION.repo });
    expect(siteFor({ VITE_REPO: DEV.repo })).toEqual({ production: false, url: DEV.url, github: '', issues: DEV.repo });
    expect(siteFor({})).toEqual({ production: false, url: DEV.url, github: '', issues: DEV.repo });
    expect(siteFor({ VITE_REPO: PRODUCTION.repo, VITE_SITE_URL: 'https://example.com/' }).url).toBe('https://example.com/');
    // GitHub のリポジトリの名前は、大文字・小文字を区別しない
    expect(siteFor({ VITE_REPO: 'Tsukaima-Kobo/Voice-Match' }).production).toBe(true);
    expect(siteFor({ VITE_REPO: 'tsukaima-kobo/voice-match-dev' }).production).toBe(false);
    expect(siteFor({ VITE_REPO: 'someone/voice-match' }).production).toBe(false);
    expect(githubUrl('')).toBeNull();
    expect(githubUrl('tsukaima-kobo/voice-match')).toBe('https://github.com/tsukaima-kobo/voice-match');
    expect(githubUrl('not a repo')).toBeNull();
  });
  it('文・サイト・タグを入れた X の投稿の住所を作る', () => {
    const u = new URL(xIntent('声紋 & テスト', 'https://example.com/', ['voicematch', '声真似練習場']));
    expect(u.origin + u.pathname).toBe('https://x.com/intent/tweet');
    expect(u.searchParams.get('text')).toBe('声紋 & テスト');
    expect(u.searchParams.get('url')).toBe('https://example.com/');
    expect(u.searchParams.get('hashtags')).toBe('voicematch,声真似練習場');
  });
});
