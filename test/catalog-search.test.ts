// 声の一覧（src/data/catalog-search.ts）の試験。
import { describe, expect, it } from 'vitest';
import { filterCatalog, groupByAffiliation, searchKey } from '../src/data/catalog-search.ts';
import { maskOf } from '../src/data/kinds.ts';
import type { CatalogEntry } from '../src/data/types.ts';

const e = (id: string, name: string, group?: string, kinds: string[] = ['vtuber']): CatalogEntry => ({ id, name, ...(group ? { group } : {}), kinds, links: { profile: `https://example.com/${id}` } });
const list = [
  e('v-1', 'アイラニ・イオフィフティーン', 'hololive Indonesia 1期生'),
  e('v-2', '春崎エアル', 'にじさんじ'),
  e('v-3', '静凛', 'にじさんじ'),
  e('v-4', 'Ｓａｍｐｌｅ　Ｓｉｎｇｅｒ', undefined, ['singer']),
  e('v-5', '熱千めら', 'ホロライブ', ['vtuber', 'singer']),
];

describe('声の一覧', () => {
  it('全角と半角・大文字と小文字・ひらがなとカタカナ・空白・点の違いは気にしない', () => {
    expect(searchKey('Ｓａｍｐｌｅ　Ｓｉｎｇｅｒ')).toBe('samplesinger');
    expect(searchKey('アイラニ・イオフィフティーン')).toBe(searchKey('あいらに いおふぃふてぃーん'));
  });
  it('名前か所属で探す（言葉が複数なら、全部に合う物）', () => {
    expect(filterCatalog(list, 'えある').map((x) => x.id)).toEqual(['v-2']);
    expect(filterCatalog(list, 'にじさんじ').map((x) => x.id)).toEqual(['v-2', 'v-3']);
    expect(filterCatalog(list, 'にじさんじ 静').map((x) => x.id)).toEqual(['v-3']);
    expect(filterCatalog(list, 'sample singer').map((x) => x.id)).toEqual(['v-4']);
    expect(filterCatalog(list, '  ').length).toBe(list.length);
    expect(filterCatalog(list, 'いない人')).toEqual([]);
  });
  it('英語の名前・所属の英語の名前でも探せる。所属ごとの見出しには英語の名前を添える', () => {
    const en = [{ ...list[1]!, nameEn: 'Earu Harusaki', groupEn: 'NIJISANJI' }, list[2]!, list[0]!];
    expect(filterCatalog(en, 'earu').map((x) => x.id)).toEqual(['v-2']);
    expect(filterCatalog(en, 'nijisanji').map((x) => x.id)).toEqual(['v-2']);
    expect(filterCatalog(en, 'にじさんじ').map((x) => x.id)).toEqual(['v-2', 'v-3']);
    const g = groupByAffiliation(en);
    expect(g.map((x) => [x.group, x.groupEn])).toEqual([['にじさんじ', 'NIJISANJI'], ['hololive Indonesia 1期生', undefined]]);
  });
  it('大枠で絞る', () => {
    expect(filterCatalog(list, '', maskOf(['singer'])).map((x) => x.id)).toEqual(['v-4', 'v-5']);
    expect(filterCatalog(list, 'ホロ', maskOf(['singer'])).map((x) => x.id)).toEqual(['v-5']);
  });
  it('所属ごとにまとめる。人の多い所属が先、所属の無い人は最後、名前は順に', () => {
    const g = groupByAffiliation(list);
    expect(g.map((x) => x.group)).toEqual(['にじさんじ', 'hololive Indonesia 1期生', 'ホロライブ', null]);
    expect(g[0]!.entries.map((x) => x.id)).toEqual(['v-2', 'v-3']);
  });
  it('英語のページでは、出す名前（英語名。無い人は日本語の名前）の順に並べる', () => {
    const en = [
      { ...e('a', 'あいうえ', 'にじさんじ'), nameEn: 'Zed', groupEn: 'NIJISANJI' },
      { ...e('b', 'かきくけ', 'にじさんじ'), nameEn: 'Amy' },
      { ...e('c', 'さしすせ', 'ホロライブ'), groupEn: 'hololive' },
      { ...e('d', 'たちつて', 'ぶいすぽ'), groupEn: 'VSPO!' },
    ];
    expect(groupByAffiliation(en, 'ja')[0]!.entries.map((x) => x.id)).toEqual(['a', 'b']);
    expect(groupByAffiliation(en, 'en')[0]!.entries.map((x) => x.id)).toEqual(['b', 'a']);
    // 同じ人数の所属も、出す所属の名前の順（英語では hololive が VSPO! より先）
    expect(groupByAffiliation(en, 'ja').map((x) => x.group)).toEqual(['にじさんじ', 'ぶいすぽ', 'ホロライブ']);
    expect(groupByAffiliation(en, 'en').map((x) => x.group)).toEqual(['にじさんじ', 'ホロライブ', 'ぶいすぽ']);
  });
});
