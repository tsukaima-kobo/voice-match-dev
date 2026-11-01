# voice-twin

一言話すと、声を測って、事前に測った声（数百〜、最終的には数万）の中から近い声を出す Web ページです。もう一言ずつ話すほど絞り込み、最大 45 項目（声の高さ・響き・話す速さなど）で比べます。ふだんの声でも、声真似でも試せます。利用者は何も登録しません。

- 声真似の点数のページ（`mimic.html`）もあります。お手本を選ぶか聞かせてから真似して話すと、近さの点数と直し方を出します。お手本がセリフ 1 つなら、抑揚とタイミングまで比べます（セリフ真似）。
- 探している声が無い時は、だれでもログインなしで声を登録できます（アキネーター方式）。3 つの壁（アルゴリズム・毎日の AI 判定・別々の 3 件以上がそろう）を通った声だけが出ます。[受け付けの設定](docs/registration.md)
- 声（お手本の音も）は利用者の端末の中だけで数字にして、すぐに捨てます。どこにも送らず、保存もしません。
- 声から性別や年齢を判断しません。
- サーバーを持たない静的なサイトです（GitHub Pages）。外のサーバーには何も読みに行きません。

## 開発

```sh
npm install
npm run dev              # 開発用のサーバー
npm test                 # 試験（合成音だけを使う）
npm run typecheck        # 型の確認
npm run build            # dist/ にサイトを作る
npm run build:collector  # 収集の拡張機能を collector/dist に作る
npm run build:voices     # data/voices/ から代表値（data/profiles.json）を作る
npm run eval             # 照合のモデル（data/model.json）を作り、見分ける力を測る（3 つ以上の声がある時）
npm run intake -- --csv 回答.csv  # 声の登録を取り込む（毎日は GitHub Actions が Google スプレッドシートから）
```

## つくり

| 場所 | 中身 |
|---|---|
| `index.html`・`src/ui/voice-page.ts` | 声のページ（お題・マイク・近い声 5 つ・確かさ・もう一言で絞り込む・自分の声の数字） |
| `mimic.html`・`src/ui/mimic-page.ts` | 声真似の点数（お手本・真似・点数と直し方・お題） |
| `src/match/match.ts` | 利用者の数字と、事前に測った声の代表値を比べて近い順に並べる（どの端末でも同じ順位） |
| `about.html` | しくみと約束、データの削除のお願い |
| `src/voice/measure.ts` | 声（PCM）から 45 項目の数字を出す。DOM なし・乱数なし（同じ音なら同じ数字） |
| `src/voice/features.ts` | 項目の名前・単位・説明・画面の目盛り |
| `src/voice/combine.ts` | 長い音を 30 秒ずつ測って中央値にする（音声ファイルのお手本と、代表値づくりで共通） |
| `src/voice/takes.ts` | 何回かに分けて話した声を、数字だけで 1 つにまとめる・確かさ |
| `src/voice/listen.ts`・`wave.ts` | マイクとほかのタブの音、録音中の波形 |
| `src/mimic/mimic.ts` | 真似の点数と直し方（自分で変えやすい 12 項目。幅は暫定） |
| `src/mimic/line.ts` | セリフ真似: 抑揚とタイミングを、時間をそろえて（DTW）比べる |
| `src/ui/orb.ts`・`line-chart.ts` | 声に反応する玉（WebGL）、セリフ真似の図（SVG） |
| `src/i18n.ts`・`public/lang.js` | 言葉（日本語・英語）。見出しの右の JP / EN で切り替え。ページの文は両方を書き、CSS で片方を見せる。最初の言葉は ?lang=・前に選んだ言葉・ブラウザーの言葉の順 |
| `src/ui/live-analysis.ts` | 録っている間の解析パネル（声の成分の図・高さの線・数字・測れる項目）と、計算中の演出 |
| `src/voice/measure.worker.ts`・`measure-async.ts` | 測定を Web Worker で（計算の間も画面が止まらない） |
| `src/ui/voiceprint.ts`・`voice-shape.ts` | 声紋: 測った数字から描く図（WebGL2。18 項目に連動）と、図の読み方。WebGL2 が無い時の 2D の図 |
| `src/prompts/prompts.ts` | お題 |
| `src/submit/` | 声の登録: 送る内容と壁 ①（`code.ts`）、壁 ③（`consensus.ts`）、Google フォームの住所（`config.ts`） |
| `tools/intake.ts` | 声の登録の取り込み（シートから。壁 ① をもう一度・dots の判定・壁 ③・削除と禁止の言葉のタブ）→ `data/generated/`（ビルドの時だけ） |
| `.github/workflows/site.yml` | 毎日と push の時に、シートを読んでサイトを作り、GitHub Pages へ公開（リポジトリには書き込まない） |
| `collector/` | お手本の声を事前に測る Chrome 拡張機能（運営用。ストアには出さない）。[使い方](docs/collector.md) |
| `tools/` | 代表値づくり（`build-voices.ts`）、照合のモデルと見分ける力の評価（`eval.ts`）、配信の経路で数字がどれだけ動くか（`channel.ts`） |
| `data/` | 声の名前・リンク（`catalog.json`）、30 秒ごとの数字（`voices/`）、代表値（`profiles.json`）、照合のモデル（`model.json`）。登録から出た声は、サイトを作る時だけ Google スプレッドシートから `data/generated/` に作る（リポジトリには入れない） |

## 声のデータの作り方

1. `data/catalog.json` に声を足す（ID・名前・所属や作品名・公式ページのリンク）。
2. 収集の拡張機能で、その声の配信や動画を再生しながら測り、書き出したファイルを `data/voices/` に入れる（[使い方](docs/collector.md)）。
3. `npm run build:voices` で代表値を作り、`npm run eval` で照合のモデルを作り、`npm run build` でサイトを作り直す。

## ライセンス

未定です。
