// スプレッドシートを読む（tools/sheets.ts）: 読めないタブは空の一覧にせず、誤りで止める（通信は試験の中の作り物）
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSheet } from '../tools/sheets.ts';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const key = JSON.stringify({ client_email: 'test@example.com', private_key: privateKey });

afterEach(() => vi.unstubAllGlobals());

describe('スプレッドシートを読む', () => {
  it('「削除」のタブが無い（Sheets API が 400）時は、空の一覧にせず止める', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
      if (decodeURIComponent(String(url)).includes('削除!A:A')) return new Response(JSON.stringify({ error: { code: 400, message: 'Unable to parse range' } }), { status: 400 });
      return new Response(JSON.stringify({ values: [['名前'], ['だれか']] }), { status: 200 });
    });
    const sheet = await openSheet(key, 'sheet-id');
    expect(await sheet.read('禁止の言葉!A:A')).toEqual([['名前'], ['だれか']]);
    await expect(sheet.read('削除!A:A')).rejects.toThrow(/削除!A:A.*400.*タブ/);
    // 空として読む道は無い
    expect(Object.keys(sheet)).toEqual(['read']);
  });
  it('空のタブ（見出しだけ・何も無い）は、空の一覧として読む', async () => {
    vi.stubGlobal('fetch', async (url: string) => (String(url).includes('oauth2') ? new Response(JSON.stringify({ access_token: 't' }), { status: 200 }) : new Response(JSON.stringify({ range: '削除!A1:A1000' }), { status: 200 })));
    const sheet = await openSheet(key, 'sheet-id');
    expect(await sheet.read('削除!A:A')).toEqual([]);
  });
});
