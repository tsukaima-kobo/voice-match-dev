// 声の登録の受け口（Google フォーム）。運営がフォームを作ったら入れる（docs/registration.md）。
// url が空の間は、ページは「受け付けの準備中」と出し、送る内容は作るが送り先は出さない。
export const SUBMIT_FORM = {
  /** フォームの住所（https://docs.google.com/forms/d/e/…/viewform） */
  url: '',
  /** 「送る内容」の質問の entry 番号（例 "123456789"）。入れると、送る内容を入れた状態でフォームが開く */
  entry: '',
};
