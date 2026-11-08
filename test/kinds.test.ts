// 大枠（src/data/kinds.ts）: 番号は固定。人が書いた大枠を読む
import { describe, expect, it } from 'vitest';
import { idsOf, KINDS, maskOf, parseKinds } from '../src/data/kinds.ts';

describe('大枠', () => {
  it('番号は決まったまま（データに番号で入るので、変えると前のデータが別の大枠になる）', () => {
    expect(KINDS.map((k) => [k.id, k.bit])).toEqual([
      ['vtuber', 0],
      ['streamer', 1],
      ['singer', 2],
      ['voice-actor', 3],
      ['actor', 4],
      ['comedian', 5],
      ['idol', 6],
      ['announcer', 7],
      ['anime', 8],
      ['game', 9],
      ['other', 15],
    ]);
  });

  it('ID の一覧と印の束を行き来できる（知らない ID は無視）', () => {
    expect(maskOf(['vtuber', 'singer', 'nope'])).toBe(0b101);
    expect(idsOf(0b101 | (1 << 15))).toEqual(['vtuber', 'singer', 'other']);
    expect(idsOf(1 << 12)).toEqual([]);
  });

  it('日本語・英語・ID・番号（1〜16）を、読点やカンマで区切って書ける', () => {
    expect(parseKinds('VTuber、歌手').mask).toBe(0b101);
    expect(parseKinds('vtuber, Singer').mask).toBe(0b101);
    expect(parseKinds('ＶＴｕｂｅｒ').mask).toBe(1);
    expect(parseKinds('配信者・YouTuber').mask).toBe(0b10);
    expect(parseKinds('1,3,16').mask).toBe(0b101 | (1 << 15));
    expect(parseKinds('アニメのキャラ\nゲームのキャラ').mask).toBe((1 << 8) | (1 << 9));
    expect(parseKinds('').mask).toBe(0);
    expect(parseKinds('VTuber、ぬいぐるみ')).toEqual({ mask: 1, unknown: ['ぬいぐるみ'] });
    // 空いている番号は大枠ではない
    expect(parseKinds('12').unknown).toEqual(['12']);
  });
});
