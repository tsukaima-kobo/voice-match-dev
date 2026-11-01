# 本番のリリースの手順（運営用）

検証用リポジトリ（tsukaima-kobo/voice-twin-dev）で作った物を、本番のリポジトリに 1 コミットで出す時の手順です。
スターの導線は、ここで初めて出します（それまでは出しません）。

## 1. 決めておくこと

- [ ] ライセンス（例: MIT）。`LICENSE` を置き、README の最後に書く。
- [ ] 本番のリポジトリの名前（例: `tsukaima-kobo/voice-twin`）と、公開の住所（例: `https://tsukaima-kobo.github.io/voice-twin/`。独自ドメインにしない限り無料）。
- [ ] 削除のお願いの窓口（about.html の「窓口: 公開の時にここに書きます」を置き換える）。

## 2. ファイルを変える

- [ ] `src/site-config.ts` の `github` に本番のリポジトリ（`"tsukaima-kobo/voice-twin"` など）を入れる。これで、見出しの GitHub のリンク・結果の下の「GitHub でスターする」・足元の GitHub・しくみと約束の「オープンソース」の節が出る。スターの数は毎朝のビルドで GitHub から取って、ページに書き込む（見る人のブラウザーは GitHub に問い合わせない）。
- [ ] 公開の住所を、本番のリポジトリの Settings → Secrets and variables → Actions → Variables に `VITE_SITE_URL`（末尾の `/` まで）として入れ、`.github/workflows/site.yml` の build の env に `VITE_SITE_URL: ${{ vars.VITE_SITE_URL }}` を足す（OGP・共有カード・X の投稿に入る住所）。または `src/site-config.ts` と `vite.config.ts` の既定の住所を書き換える。
- [ ] README の「サイトを開く」などの住所を本番に変える。
- [ ] 登録のフォーム（`src/submit/config.ts`）を本番のフォームにする。

## 3. GitHub のリポジトリの設定（本番）

- [ ] About（右上の歯車）: 説明 `あなたの声は、誰に近い？ 一言で声を 45 項目に測り、近い声と声紋を出す / Whose voice is yours closest to? Measure your voice in 45 ways, right in the browser.`、Website に公開の住所。
- [ ] Topics: `voice` `voice-analysis` `web-audio-api` `webgl` `mfcc` `spectrogram` `vtuber` `voice-acting` `typescript` `vite` `japanese`
- [ ] Settings → General → Social preview: `public/og.jpg`（1200×630）を上げる（GitHub のリンクを共有した時の絵）。
- [ ] Settings → Pages: Source を「GitHub Actions」。
- [ ] Secrets（登録を受ける時）: `GOOGLE_SA_KEY`・`SHEET_ID`（`docs/registration.md`）。

## 4. 広める（スターは買わない・交換しない。GitHub の規約で禁止）

- X: 声紋が描き出される動画、リアルタイム解析の動画、共有カード。
- Zenn・Qiita: ブラウザーだけで声を 45 項目に、WebGL の声紋、Web Worker、BGM を引く測り方。
- 英語: Hacker News の Show HN（登録なしで試せる物が向いている）、Reddit（それぞれの場所の決まりを読んでから）。
