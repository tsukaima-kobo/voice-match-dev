// 画面に出す声の名前と所属（src/data/names.ts）
import { describe, expect, it } from 'vitest';
import { groupOf, nameOf } from '../src/data/names.ts';

describe('画面に出す名前', () => {
  const v = { name: '名前', nameEn: 'Name', group: '所属', groupEn: 'Agency' };
  it('英語のページでは英語の名前、日本語のページでは日本語の名前', () => {
    expect(nameOf(v, 'en')).toBe('Name');
    expect(nameOf(v, 'ja')).toBe('名前');
    expect(groupOf(v, 'en')).toBe('Agency');
    expect(groupOf(v, 'ja')).toBe('所属');
  });
  it('英語の名前が無ければ、英語のページでも日本語のまま。所属が無ければ無し', () => {
    expect(nameOf({ name: '名前' }, 'en')).toBe('名前');
    expect(groupOf({ group: '所属' }, 'en')).toBe('所属');
    expect(groupOf({}, 'en')).toBeUndefined();
    expect(nameOf({ name: '名前', nameEn: '' }, 'en')).toBe('名前');
  });
  it('言葉を渡さない時は、今の言葉（ブラウザーの無い所では日本語）', () => {
    expect(nameOf(v)).toBe('名前');
  });
});
