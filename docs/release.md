# 本番のリリースの手順（運営用）

検証用リポジトリ（tsukaima-kobo/voice-match-dev）で作った物を、本番のリポジトリに 1 コミットで出す時の手順です。
スターの導線は、ここで初めて出します（それまでは出しません）。

## 1. 決めておくこと

- [x] ライセンス: MIT（2026-11-01 運営が決定。`LICENSE` と README の最後に書いた）。本番のリポジトリにも `LICENSE` をそのまま入れる。
- [x] 本番のリポジトリの名前: `tsukaima-kobo/voice-match`（2026-11-07 運営が決定）。`src/site-config.ts` の `PRODUCTION`。
- [x] 公開の住所: `https://voice-match.com/`（2026-11-04 運営が Cloudflare で取得。サイトは同じ Cloudflare アカウントの Pages に置く。手順は 3.5）。
- [x] 削除のお願いの窓口（2026-11-07）: Google フォーム「voice-match 削除のお願い」（運営のアカウント。回答はメールで知らせる）・メール contact@voice-match.com（Cloudflare のメール転送で運営の Gmail へ）・GitHub の Issue（`.github/ISSUE_TEMPLATE/removal.yml`）。住所は `src/site-config.ts` の `removal`。

## 2. ファイルを変える

- [x] 本番の住所・スターの導線・削除のお願いの Issue の行き先は、本番のリポジトリで作ると自動で本番の物になる（`site.yml` がリポジトリの名前を `VITE_REPO` に入れ、`src/site-config.ts` の `siteFor` が選ぶ）。ファイルを書き換えなくてよい。
  - 本番: 住所 `https://voice-match.com/`、見出しの GitHub のリンク・結果の下の「GitHub でスターする」・足元の GitHub・しくみと約束の「オープンソース」の節が出る。スターの数は毎朝のビルドで GitHub から取って、ページに書き込む（見る人のブラウザーは GitHub に問い合わせない）。検索に出る。
  - 検証用: 住所は `https://tsukaima-kobo.github.io/voice-match-dev/`、スターの導線は出さない、検索に出さない（`noindex`）。
  - 住所だけ変えたい時は、Variables の `VITE_SITE_URL` に入れる。
- [ ] 本番のリポジトリに `removal` のラベルを作る（`gh label create removal -R tsukaima-kobo/voice-match --color d93f0b --description 削除のお願い`）。Issue の型（`.github/ISSUE_TEMPLATE/`）はコードと一緒に入る。
- [x] README の「サイトを開く」などの住所は本番（`https://voice-match.com/`）にした。
- [x] 声の登録は最初から受け付ける（2026-11-08 運営が決定）。本番のフォーム「voice-match 声の登録」とシート「voice-match 声の登録（回答）」（タブ: フォームの回答 1・削除・禁止の言葉）を作った。本番で作ると `src/submit/config.ts` が本番のフォームを使う（検証用は検証用のフォーム）。
- [ ] 登録の取り込み: dots に本番のシートを見させる（`docs/registration.md` 3）。Google Cloud のサービス アカウントの鍵を作り、本番のシートを閲覧者で共有する（同 4）。本番のリポジトリの Secrets に `GOOGLE_SA_KEY`・`SHEET_ID`（本番のシートの住所の `/d/` と `/edit` の間）、Variables に `SHEET_RANGE` = `フォームの回答 1!A:D`。

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
4. push するか、Actions の site →「Run workflow」。最初の 1 回で Cloudflare に `voice-match` のプロジェクトができ、`https://voice-match.pages.dev/` に出る（名前が取られていたら少し違う住所になる）。
5. Cloudflare → Workers & Pages → voice-match → カスタムドメイン → `voice-match.com` を追加。同じアカウントのドメインなので、DNS は自動で入る。`www.voice-match.com` も使うなら、同じように足す。
6. GitHub の Settings → Pages は使わないので、Source を「なし」のままにする。

## 3.7 運営が測った声を本番に置く

```sh
GH_REPO=tsukaima-kobo/voice-match node tools/voices-release.ts upload --yes
```

## 3.8 出した後の検証用（tsukaima-kobo/voice-match-dev）

声が本番だけにあれば、削除のお願いを 1 か所で済ませられる。本番のページが見られるようになったら:

- [ ] 検証用の Release「voices-data」を消す（`gh release delete voices-data -R tsukaima-kobo/voice-match-dev --cleanup-tag --yes`）。
- [ ] 検証用のサイトを止める（`gh workflow disable site -R tsukaima-kobo/voice-match-dev` と、Settings → Pages → Unpublish site）。
- 検証用のリポジトリは、コードを作る場所として残す。確かめる時は手元（`npm run dev`）で開く。

## 4. 広める（スターは買わない・交換しない。GitHub の規約で禁止）

- X: 声紋が描き出される動画、リアルタイム解析の動画、共有カード。
- Zenn・Qiita: ブラウザーだけで声を 45 項目に、WebGL の声紋、Web Worker、BGM を引く測り方。
- 英語: Hacker News の Show HN（登録なしで試せる物が向いている）、Reddit（それぞれの場所の決まりを読んでから）。
