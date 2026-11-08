// サイトの外へのリンク（site-config.ts）: 作った人のリンクは https:// の物だけ、GitHub は設定がある時だけ、X の投稿の住所。
import { describe, expect, it } from 'vitest';
import { githubUrl, makerLinks, SITE, xIntent } from '../src/site-config.ts';

describe('外へのリンク', () => {
  it('作った人のリンクは、完全な https:// の物だけを、決まった順で出す', () => {
    expect(makerLinks({ x: 'https://x.com/a', youtube: 'http://youtube.com/b', note: null, zenn: 'javascript:alert(1)', qiita: 'https://qiita.com/c' }).map((l) => l.id)).toEqual(['x', 'qiita']);
    expect(makerLinks().map((l) => l.name)).toEqual(['X', 'YouTube', 'note', 'Zenn', 'Qiita']);
  });
  it('リポジトリが決まるまで、GitHub のスターのリンクは隠す', () => {
    expect(SITE.github).toBe('');
    expect(githubUrl()).toBeNull();
    expect(githubUrl('tsukaima-kobo/voice-twin')).toBe('https://github.com/tsukaima-kobo/voice-twin');
    expect(githubUrl('not a repo')).toBeNull();
  });
  it('文・サイト・タグを入れた X の投稿の住所を作る', () => {
    const u = new URL(xIntent('声紋 & テスト', 'https://example.com/', ['voicetwin', '声真似練習場']));
    expect(u.origin + u.pathname).toBe('https://x.com/intent/tweet');
    expect(u.searchParams.get('text')).toBe('声紋 & テスト');
    expect(u.searchParams.get('url')).toBe('https://example.com/');
    expect(u.searchParams.get('hashtags')).toBe('voicetwin,声真似練習場');
  });
});
