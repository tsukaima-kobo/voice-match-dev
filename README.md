<p align="center"><img src="docs/images/voiceprint.jpg" width="280" alt="voice-match の声紋（voiceprint）"></p>

<h1 align="center">voice-match</h1>

<p align="center"><b>あなたの声は、誰に近い？</b> — 一言話すだけで声を 45 項目で測り、近い声と、あなただけの声紋を出す Web サイト。<br>
<b>Whose voice is yours closest to?</b> Say a single phrase: we measure your voice in 45 ways, find the closest voices, and draw your own voiceprint.</p>

<p align="center"><a href="https://voice-match.com/"><b>▶ サイトを開く / Try it</b></a>　·　<a href="https://voice-match.com/?lang=en">English</a>　·　<a href="https://x.com/tsukaima_kobo">X @tsukaima_kobo</a></p>

<p align="center"><img src="docs/images/card-voice.jpg" width="300" alt="共有カード（近い声）"> <img src="docs/images/card-mimic.jpg" width="300" alt="共有カード（声真似の点数）"></p>

## できること / Features

- **一言から近い声 / From one phrase**: 声の高さ・響き・音色・声の質から、事前に測った声の中で近い順に 5 つ。近さは「とても似ている・よく似ている・似ている・似ている所がある」の言葉で出します。もう一言ずつ話すほど絞り込み、続けて長く話すと速さや間まで 45 項目で比べます。大枠（VTuber・歌手など）で探す範囲を絞れます。
- **声紋 / Voiceprint**: 測った 18 の項目が、それぞれ図のどこかを動かす指紋のような図（WebGL2）。名前を押すと、図のその場所に印と数字。
- **リアルタイム解析 / Live analysis**: 話している間、スペクトログラム・高さの線・数字・測れるようになった項目をその場で計算して見せます。
- **声真似の点数 / Mimic score**: お手本のセリフと同じセリフを真似すると、抑揚・タイミング・声の質で点数と直し方。2 本の線を重ねた図。
- **じっくり測る / Measure in depth**: 決まった文を 20 分ほど読むと、サイトの声と同じ作り方であなたの声の代表値を作ります。声のページの比べる相手に入れて、自分が何位に出るかを試せます。
- **声の一覧 / Voice list**: サイトに入っている声を所属ごとに並べ、名前・所属で探せます。
- **シェア / Share**: 結果を共有カード（1080×1350）にして X へ。
- **日本語と英語 / Japanese and English**: 同じページで JP / EN を切り替え。

## 約束 / Promises

- 声は端末の中だけで数字にして、すぐに捨てます。どこにも送らず、保存もしません。 / Your voice is turned into numbers on your device and thrown away at once — never sent, never stored.
- サーバーを持たない静的なサイト（Cloudflare Pages）で、外のサーバーには何も読みに行きません。 / A static site with no server (on Cloudflare Pages); it loads nothing from elsewhere.
- サイトに置いている 1 人分の声は、45 項目の中央値を 1 つ 1 バイトにした、45 バイトの数字だけです。音は入っていません。 / Each voice on the site is just 45 bytes of numbers — no sound.
- 声から性別や年齢を判断しません。 / Gender and age are never guessed from a voice.
- 利用者は何も登録しません。 / No sign-up.

## くわしく

一言話すと、声を測って、事前に測った声（数百〜、最終的には数万）の中から近い声を出す Web ページです。もう一言ずつ話すほど絞り込み、最大 45 項目（声の高さ・響き・話す速さなど）で比べます。ふだんの声でも、声真似でも試せます。利用者は何も登録しません。

- 声のページ（`index.html`）: お題か決まった文を話すと、近い声 5 つ・近さの言葉・似ている所と違う所・自分の声の数字と声紋を出します。
- 声真似の点数のページ（`mimic.html`）: お手本を選ぶか聞かせてから真似して話すと、近さの点数と直し方を出します。お手本がセリフ 1 つなら、抑揚とタイミングまで比べます（セリフ真似）。
- じっくり測るページ（`measure.html`）: 決まった文を 20 分ほど読み、30 秒ごとの数字の中央値で代表値を作ります。声のページの相手に入れた数字は、このブラウザーの中だけに残り、「外す」で消えます。
- 声の一覧（`voices.html`）: 入っている声を所属ごとに並べ、名前・所属で探し、大枠で絞れます。探した言葉は URL に入ります。
- 探している声が無い時は、だれでもログインなしで声を登録できます（アキネーター方式）。3 つの壁（アルゴリズム・毎日の AI 判定・別々の 3 件以上がそろう）を通った声だけが出ます。[受け付けの設定](docs/registration.md)
- 載っている声の削除のお願いは、しくみと約束のページ（`about.html` の 07）にある Google フォーム・メール（contact@voice-match.com）・GitHub の Issue で受け付けます。

## 開発

```sh
npm install
npm run dev              # 開発用のサーバー
npm test                 # 試験（合成音だけを使う）
npm run typecheck        # 型の確認
npm run build            # dist/ にサイトを作る
npm run build:collector  # 収集の拡張機能を collector/dist に作る
npm run build:voices     # data/voices/ から代表値（data/profiles.json）を作る
node tools/eval.ts --sheet <シート.xlsx>  # 運営が測った声（スプレッドシート）から、照合のモデル（data/model.json）と近さの言葉の目安を作り、見分ける力を測る
npm run eval             # 同じことを、拡張機能で測った声（data/voices/）だけから（シートから作ったモデルは置き換えずに止まる）
npm run intake -- --csv 回答.csv  # 声の登録を取り込む（毎日は GitHub Actions が Google スプレッドシートから）
node tools/voices-release.ts make --sheet <シート.xlsx> --only <出す人の一覧>  # 運営が測った声の代表値を作る（docs/voices-release.md）
```

## つくり

| 場所 | 中身 |
|---|---|
| `index.html`・`src/ui/voice-page.ts` | 声のページ（お題・マイク・近い声 5 つ・近さの言葉・確かさ・もう一言で絞り込む・自分の声の数字） |
| `mimic.html`・`src/ui/mimic-page.ts` | 声真似の点数（お手本・真似・点数と直し方・お題） |
| `measure.html`・`src/ui/measure-page.ts` | じっくり測る（決まった文を読む・30 秒ごとの数字・代表値・声のページの相手に入れる・数字を書き出す） |
| `voices.html`・`src/ui/voices-page.ts` | 声の一覧（所属ごと・名前と所属で探す・大枠で絞る） |
| `about.html`・`src/ui/about-page.ts` | しくみと約束、データの削除のお願い |
| `src/voice/measure.ts` | 声（PCM）から 45 項目の数字を出す。DOM なし・乱数なし（同じ音なら同じ数字） |
| `src/voice/features.ts` | 項目の名前・単位・説明・画面の目盛り |
| `src/voice/combine.ts` | 長い音を 30 秒ずつ測って中央値にする（音声ファイルのお手本と、代表値づくりで共通） |
| `src/voice/session.ts` | じっくり測る時の 30 秒の区切り・代表値・書き出すファイル |
| `src/voice/takes.ts` | 何回かに分けて話した声を、数字だけで 1 つにまとめる・確かさ |
| `src/voice/listen.ts`・`wave.ts` | マイクとほかのタブの音（声真似のお手本）、録音中の波形 |
| `src/voice/measure.worker.ts`・`measure-async.ts` | 測定を Web Worker で（計算の間も画面が止まらない） |
| `src/match/match.ts` | 利用者の数字と、事前に測った声の代表値を比べて近い順に並べる（どの端末でも同じ順位）。近さの言葉 |
| `src/mimic/mimic.ts` | 真似の点数と直し方（自分で変えやすい 12 項目） |
| `src/mimic/line.ts` | セリフ真似: 抑揚とタイミングを、時間をそろえて（DTW）比べる |
| `src/data/` | サイトの声の読み込み（`load.ts`）・詰め方（`pack.ts`、1 項目 1 バイト）・元のまとめ方（`sources.ts`。同じ名前・削除の一覧）・照合のモデルのファイルの確かめ（`model-file.ts`）・大枠（`kinds.ts`）・声の一覧の探し方（`catalog-search.ts`）・じっくり測った自分の声（`mine.ts`） |
| `src/ui/orb.ts`・`line-chart.ts` | 声に反応する玉（WebGL）、セリフ真似の図（SVG） |
| `src/ui/voiceprint.ts`・`voice-shape.ts` | 声紋: 測った数字から描く図（WebGL2。18 項目に連動）と、図の読み方。WebGL2 が無い時の 2D の図 |
| `src/ui/live-analysis.ts` | 録っている間の解析パネル（声の成分の図・高さの線・数字・測れる項目）と、計算中の演出 |
| `src/ui/mic-picker.ts` | 使うマイクを選ぶ |
| `src/ui/share.ts`・`share-card.ts` | 結果のシェア（X に投稿・画像を保存・画像つきで共有）、共有カード（1080×1350）、作った人のリンク、GitHub のスター |
| `src/site-config.ts` | 本番か検証用か（`siteFor` がリポジトリの名前で選ぶ。公開の住所・スターの導線・削除のお願いの Issue の行き先が変わる。検証用ではスターの導線を出さない）・作った人のリンク（X など）・削除のお願いの窓口 |
| `src/i18n.ts`・`public/lang.js` | 言葉（日本語・英語）。見出しの右の JP / EN で切り替え。ページの文は両方を書き、CSS で片方を見せる。最初の言葉は ?lang=・前に選んだ言葉・ブラウザーの言葉の順 |
| `src/prompts/prompts.ts` | お題と決まった文 |
| `src/submit/` | 声の登録: 送る内容と壁 ①（`code.ts`）、壁 ③（`consensus.ts`）、Google フォームの住所（`config.ts`） |
| `public/og.jpg`・`vite.config.ts` | SNS で共有された時の絵と、OGP・X のカードの設定。サイトの声をまとめて詰める（`voicePack`） |
| `collector/` | お手本の声を事前に測る Chrome 拡張機能（運営用。ストアには出さない）。[使い方](docs/collector.md) |
| `tools/voices-release.ts` | 運営が測った声（スプレッドシート）から代表値のファイルを作り、GitHub の Release に置く。[手順](docs/voices-release.md) |
| `tools/eval.ts`・`lib.ts` | 照合のモデル・近さの言葉の目安・見分ける力の評価 |
| `tools/build-voices.ts`・`channel.ts` | 拡張機能の数字からの代表値づくり、配信の経路で数字がどれだけ動くか |
| `tools/intake.ts` | 声の登録の取り込み（シートから。壁 ① をもう一度・dots の判定・壁 ③・削除と禁止の言葉のタブ）→ `data/generated/`（ビルドの時だけ。削除のタブの名前は、運営が測った声などにも当てる） |
| `tools/github-stars.ts` | スターの数をビルドの時に取ってページに書く（設定がある時だけ） |
| `.github/workflows/site.yml` | 毎日と push の時に、Release とシートを読んでサイトを作り、公開（本番は Cloudflare Pages、検証用は GitHub Pages。リポジトリには書き込まない） |
| `data/` | 照合のモデル（`model.json`）と評価（`eval-report.json`）。拡張機能で測った声（`catalog.json`・`voices/`・`profiles.json`）。運営が測った声（Release から）と登録から出た声は、サイトを作る時だけ `data/generated/` に作る（リポジトリには入れない） |

## 声のデータの作り方

- **運営が測った声**: 配信の音から 30 秒ごとに測った数字をスプレッドシートに集め、`tools/voices-release.ts` で 1 人 1 件の代表値にして、GitHub の Release「voices-data」に置きます。サイトを作る時に取ってきます。数字はリポジトリにコミットしません（[手順](docs/voices-release.md)）。
- **拡張機能で測った声**: `data/catalog.json` に声を足し、収集の拡張機能で配信や動画を再生しながら測って、書き出したファイルを `data/voices/` に入れます（[使い方](docs/collector.md)）。`npm run build:voices` で代表値を作ります。
- 照合のモデルと近さの言葉の目安は、運営が測った声から `node tools/eval.ts --sheet <シート.xlsx>`（代表値と同じ窓を使う）で作り直します。`--sheet` の無い `npm run eval` は、拡張機能で測った声（`data/voices/`）だけで作る時のための物です。今の `data/model.json` がシートから作った物なら、置き換えずに止まります。サイトは `npm run build` で作り直します。
- 照合のモデルの測り方の版が、今の版でも、そのまま比べてよい前の版（`src/voice/measure.ts` の `MEASURE_COMPATIBLE`）でもない時は、`npm run build` が止まります（仮のモデルで黙って公開しないため）。測り方を変えた時は、測り直したデータからモデルを作り直します。

## 本番のリリース

[docs/release.md](docs/release.md)（本番のリポジトリ・スターの導線を出す・GitHub の設定・広め方）。

## ライセンス / License

プログラムは [MIT ライセンス](LICENSE) です。 / The code is released under the [MIT License](LICENSE).

声の名前・公式ページへのリンクなどは、それぞれの声のご本人・権利者の物です（ライセンスの対象は、このリポジトリのプログラムだけ）。 / Names of voices and links to their official pages belong to their owners; the license covers this repository’s code only.
