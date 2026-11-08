// 声の登録の受け口（Google フォーム）。運営がフォームを作ったら入れる（docs/registration.md）。
// 本番と検証用でフォームとシートを分ける（検証用で試した登録が、本番のシートに混ざらないように）。どちらを使うかは site-config.ts の SITE.production。
// url が空の間は、ページは「受け付けの準備中」と出し、送る内容は作るが送り先は出さない。
import { SITE } from '../site-config.ts';

/** フォームの住所（https://docs.google.com/forms/d/e/…/viewform）と、「送る内容」の質問の entry 番号（入れると、送る内容を入れた状態でフォームが開く） */
export type SubmitForm = { url: string; entry: string };

/** 本番: フォーム「voice-match 声の登録」→ シート「voice-match 声の登録（回答）」 */
export const PRODUCTION_FORM: SubmitForm = {
  url: 'https://docs.google.com/forms/d/e/1FAIpQLSfEwYdwbxSLsdpx-8entZZO4ffHLctM0joo2ChrS1arSG07dg/viewform',
  entry: '791146777',
};

/** 検証用: 検証用のリポジトリで作った時のフォーム（本番とは別のフォームとシート） */
export const DEV_FORM: SubmitForm = {
  url: 'https://docs.google.com/forms/d/e/1FAIpQLScG5r_C3CvAPm8uw5csGCiKsDR2ougYeyIqbPsGh7GAexVNWg/viewform',
  entry: '627800295',
};

export const SUBMIT_FORM: SubmitForm = SITE.production ? PRODUCTION_FORM : DEV_FORM;
