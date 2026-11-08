// Google スプレッドシート（フォームの回答）を読む。GitHub Actions から使う（読むだけの権限のサービス アカウント）。
// 鍵は環境変数で受け取り、画面にもファイルにも出さない。誤りの時も、鍵や通行証は出さず、HTTP の番号だけを出す。
import { createSign } from 'node:crypto';

interface ServiceKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/**
 * スプレッドシートを開く（通行証を 1 回だけもらい、いくつかの範囲を読む）。
 * 読めない範囲は、空ではなく誤りにする（無いタブの範囲には、Sheets API は 400 を返す）。
 * 削除のお願いのタブを読めないまま空として進むと、消した人がまた出てしまうため。
 */
export async function openSheet(keyJson: string, sheetId: string): Promise<{ read(range: string): Promise<string[][]> }> {
  const key = JSON.parse(keyJson) as ServiceKey;
  const aud = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud, iat: now, exp: now + 600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  const tok = await fetch(aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!tok.ok) throw new Error(`Google の通行証をもらえませんでした（HTTP ${tok.status}）`);
  const { access_token } = (await tok.json()) as { access_token: string };
  return {
    async read(range) {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`, { headers: { authorization: `Bearer ${access_token}` } });
      if (!res.ok) throw new Error(`スプレッドシートの「${range}」を読めませんでした（HTTP ${res.status}${res.status === 400 ? '。タブが無いか、タブの名前が違います' : ''}）`);
      return ((await res.json()) as { values?: string[][] }).values ?? [];
    },
  };
}
