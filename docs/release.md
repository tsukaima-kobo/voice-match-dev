# 本番のリリースの手順（運営用）

検証用リポジトリ（tsukaima-kobo/voice-match-dev）で作った物を、本番のリポジトリに 1 コミットで出す時の手順です。
スターの導線は、ここで初めて出します（それまでは出しません）。

## 1. 決めておくこと

- [x] ライセンス: MIT（2026-11-01 運営が決定。`LICENSE` と README の最後に書いた）。本番のリポジトリにも `LICENSE` をそのまま入れる。
- [ ] 本番のリポジトリの名前（例: `tsukaima-kobo/voice-match`）。
- [x] 公開の住所: `https://voice-match.com/`（2026-11-04 運営が Cloudflare で取得。サイトは同じ Cloudflare アカウントの Pages に置く。手順は 3.5）。
- [ ] 削除のお願いの窓口（about.html の「窓口: 公開の時にここに書きます」を置き換える）。

## 2. ファイルを変える

- [ ] `src/site-config.ts` の `github` に本番のリポジトリ（`"tsukaima-kobo/voice-match"` など）を入れる。これで、見出しの GitHub のリンク・結果の下の「GitHub でスターする」・足元の GitHub・しくみと約束の「オープンソース」の節が出る。スターの数は毎朝のビルドで GitHub から取って、ページに書き込む（見る人のブラウザーは GitHub に問い合わせない）。
- [ ] 公開の住所を、本番のリポジトリの Settings → Secrets and variables → Actions → Variables に `VITE_SITE_URL` = `https://voice-match.com/` として入れる（OGP・共有カード・X の投稿に入る住所。`site.yml` はもう読むようになっている）。
- [ ] README の「サイトを開く」などの住所を本番に変える。
- [ ] 登録のフォーム（`src/submit/config.ts`）を本番のフォームにする。

## 3. GitHub のリポジトリの設定（本番）

- [ ] About（右上の歯車）: 説明 `あなたの声は、誰に近い？ 一言で声を 45 項目に測り、近い声と声紋を出す / Whose voice is yours closest to? Measure your voice in 45 ways, right in the browser.`、Website に公開の住所。
- [ ] Topics: `voice` `voice-analysis` `web-audio-api` `webgl` `mfcc` `spectrogram` `vtuber` `voice-acting` `typescript` `vite` `japanese`
- [ ] Settings → General → Social preview: `public/og.jpg`（1200×630）を上げる（GitHub のリンクを共有した時の絵）。
- [ ] Secrets（登録を受ける時）: `GOOGLE_SA_KEY`・`SHEET_ID`（`docs/registration.md`）。

## 3.5 Cloudflare Pages に置く（voice-match.com）

`site.yml` は、Secrets に Cloudflare の鍵がある時は Cloudflare Pages へ、無い時は GitHub Pages へ出す。鍵は運営が入れる（わたしは触らない）。

1. Cloudflare の画面: 右上の人の印 → プロフィール → API トークン → 「トークンを作成」→ カスタムトークン。権限は「アカウント・Cloudflare Pages・編集」だけ。作成して出た値を控える（一度しか出ない）。
2. Cloudflare の画面で「アカウント ID」を控える（Workers & Pages の画面の右側など）。
3. 本番のリポジトリ → Settings → Secrets and variables → Actions:
   - Secrets に `CLOUDFLARE_API_TOKEN`（1 の値）と `CLOUDFLARE_ACCOUNT_ID`（2 の値）
   - Variables に `VITE_SITE_URL` = `https://voice-match.com/`
4. push するか、Actions の site →「Run workflow」。最初の 1 回で Cloudflare に `voice-match` のプロジェクトができ、`https://voice-match.pages.dev/` に出る（名前が取られていたら少し違う住所になる）。
5. Cloudflare → Workers & Pages → voice-match → カスタムドメイン → `voice-match.com` を追加。同じアカウントのドメインなので、DNS は自動で入る。`www.voice-match.com` も使うなら、同じように足す。
6. GitHub の Settings → Pages は使わないので、Source を「なし」のままにする。

## 4. 広める（スターは買わない・交換しない。GitHub の規約で禁止）

- X: 声紋が描き出される動画、リアルタイム解析の動画、共有カード。
- Zenn・Qiita: ブラウザーだけで声を 45 項目に、WebGL の声紋、Web Worker、BGM を引く測り方。
- 英語: Hacker News の Show HN（登録なしで試せる物が向いている）、Reddit（それぞれの場所の決まりを読んでから）。
