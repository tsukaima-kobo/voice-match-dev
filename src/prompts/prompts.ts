// 練習のお題（お手本の声で話す。毎回ランダムに 1 つ。ランダムはお題の選び方だけで、測定と点数には使わない）。
// 動画のネタにもなるように、30 秒ほど話せて、思わず話したくなる物。このサイト用に書いた文。英語も同じ並びで、このサイト用に書いた文。
import { lang } from '../i18n.ts';

export const PROMPTS: readonly string[] = [
  '最近いちばん笑ったことを話してください',
  '今日の晩ごはんを、実況のように紹介してください',
  '無人島に 1 つだけ持っていくなら何か、理由と一緒に',
  '推し（好きな物・人）の魅力を、30 秒で語ってください',
  '子どものころの、ちょっとした失敗談をどうぞ',
  'あなたが考えた、新しい祝日の名前と過ごし方は？',
  '宝くじで 1 億円当たったら、最初の 1 日をどう過ごす？',
  '朝起きてから家を出るまでを、ナレーション風に',
  '最近買ってよかった物を、通販番組のように紹介してください',
  '好きな季節と、その季節にしたいことを話してください',
  'もしも 1 日だけ動物になれるなら、何になって何をする？',
  'あなたの町の、自慢できる所を紹介してください',
  '雨の日の過ごし方を、ゆっくり話してください',
  'ゲームの勇者になったつもりで、自己紹介をどうぞ',
  '天気予報のキャスターになって、明日の天気を伝えてください',
  'いま机の上にある物を 3 つ紹介してください',
  '最近のちょっとした「あるある」を話してください',
  '理想の休日を、朝から夜まで話してください',
  'もしタイムマシンがあったら、いつに行きたい？',
  '好きな食べ物を、食べたことのない人に説明してください',
  '寝る前のルーティンを教えてください',
  '最近ハマっていることを、まだ知らない人にすすめてください',
  '自分を動物にたとえると何？ その理由も',
  '人生でいちばんおいしかった物の話をどうぞ',
  '秘密基地を作るなら、どこにどんな物を作る？',
  'あなたが考えた、ちょっと変わった早口言葉に挑戦してください',
  '今年中にやってみたいことを 3 つ話してください',
  '遠足の前の日の気持ちを思い出して話してください',
  'もしも魔法が 1 つ使えるなら、どんな魔法で何をする？',
  '好きな言葉と、その言葉が好きな理由を話してください',
];

export const PROMPTS_EN: readonly string[] = [
  'Tell us about the last thing that made you laugh out loud',
  'Describe tonight’s dinner like a live sports commentator',
  'You may take one thing to a desert island — what is it, and why?',
  'Sell us on your favourite thing (or person) in 30 seconds',
  'Share a small mistake you made as a child',
  'Invent a new public holiday: its name, and how people spend it',
  'You just won the lottery. How do you spend the first day?',
  'Narrate your morning, from waking up to walking out the door',
  'Present something you bought lately, like a shopping-channel host',
  'Talk about your favourite season and what you love doing in it',
  'If you could be an animal for one day, which one, and what would you do?',
  'Show off the best thing about your town',
  'Tell us, slowly, how you spend a rainy day',
  'Introduce yourself as the hero of a fantasy game',
  'Be a weather presenter and give tomorrow’s forecast',
  'Introduce three things on your desk right now',
  'Share a small “everybody does this” moment from your week',
  'Describe your perfect day off, from morning to night',
  'If you had a time machine, when would you go?',
  'Explain your favourite food to someone who has never tried it',
  'Walk us through your bedtime routine',
  'Recommend something you are into to someone who has never heard of it',
  'If you were an animal, which would you be? Tell us why',
  'Tell us about the best meal of your life',
  'If you built a secret base, where would it be and what would be inside?',
  'Try a slightly odd tongue twister you made up yourself',
  'Name three things you want to do before the year is over',
  'Remember the night before a school trip, and tell us how it felt',
  'If you could use one kind of magic, what would it be and what would you do?',
  'Tell us a word you love, and why you love it',
];

/**
 * 決まった文（読む文。毎回ランダムに 1 つ。このサイト用に書いた文。英語も同じ並びで、このサイト用に書いた文）。
 * 1 回は最大 35 秒なので、ふつうの速さで 30 秒前後で読み終わる長さ（日本語は 220〜250 字くらい）。
 * 天気予報・昔話・料理・実況・手紙・会話など、読み方（抑揚・速さ）が変わるように種類を混ぜる。
 */
export const READINGS: readonly string[] = [
  'きのうの夜から降っていた雨が、朝にはすっかりやんでいました。窓を開けると、ぬれた土と草のにおいがして、なんだか得をした気分になります。せっかくなので、少し遠回りをして駅まで歩くことにしました。公園の池には小さな波紋がいくつも広がり、ベンチのそばでは、すずめが水たまりで羽を洗っています。角のパン屋さんからは、焼きたての甘いかおりがただよってきました。いつもなら素通りする道なのに、きょうは見るものすべてが新しく感じられます。たまには、急がない朝もいいものですね。',
  'こんばんは、明日の天気をお伝えします。明日は北から冷たい空気が流れこむため、朝は今シーズンいちばんの冷えこみとなるでしょう。日中は高気圧におおわれて、広いはんいで晴れますが、夕方からは西の地方で雲が増え、夜にはところにより小雨がぱらつく見こみです。最高気温は、きょうより三度から五度ほど低くなります。お出かけの際は、あたたかい上着を一枚お持ちください。また、空気が乾燥していますので、火の取りあつかいには十分ご注意ください。以上、明日の天気でした。',
  'むかしむかし、山のふもとの小さな村に、たいそう物知りなおばあさんが住んでいました。村の人たちは、困ったことがあると、いつもおばあさんの家をたずねます。ある年の秋、村の井戸の水が急にへってしまいました。おばあさんはだまって裏山にのぼり、半日かけて、古い大きな木の根もとを調べました。そして、もどってくるなりこう言いました。「水は、にげたのではありません。道をまちがえただけです」。次の朝、村の人たちが言われたとおりに石をどけると、井戸にはふたたび、すんだ水があふれました。',
  'きょうは、だれでも作れるふわふわの卵焼きを紹介します。まず、ボウルに卵を三つ割り入れ、砂糖を小さじ二杯と、しょうゆを少しだけ加えます。はしを立てて、白身を切るようにまぜるのがコツです。次に、フライパンを中火で温め、油をうすくひいたら、卵液を三分の一ほど流し入れます。まわりがかたまってきたら、奥から手前へ、くるくると巻いていきましょう。巻いた卵を奥へもどし、残りの卵液を二回に分けて同じように焼けば、できあがりです。焼きたてを切ると、湯気と一緒に、やさしいあまいかおりが広がります。',
  '本日は、みどりの丘動物園にお越しいただき、まことにありがとうございます。ただいま、ゾウの広場では、お食事の時間が始まっております。大きな鼻をじょうずに使って、りんごやにんじんを口へ運ぶようすを、ぜひ近くでご覧ください。また、午後二時からは、ペンギンのおさんぽタイムを予定しております。よちよちと列になって歩く姿は、当園いちばんの人気です。なお、動物たちに食べ物をあたえることはできません。まいごのお子さまは、正門横の案内所でお預かりしております。どうぞ最後まで、ごゆっくりお楽しみください。',
  'おばあちゃんへ。お元気ですか。こちらはすっかり秋らしくなって、朝晩は上着がないと少し寒いくらいです。先週送ってくれたりんご、家族みんなでおいしくいただきました。お母さんはジャムにして、わたしは毎朝それをパンにぬって食べています。学校では、来月の音楽会に向けて、毎日合唱の練習をしています。最初はなかなか声がそろわなかったけれど、最近はみんなの声がひとつになる瞬間があって、それがとてもうれしいです。冬休みには、また遊びに行きますね。かぜをひかないように、あたたかくしてすごしてください。',
  '夜空に光る星の多くは、じつは太陽と同じように、自分で光を出している星です。とても遠くにあるので、小さな点にしか見えません。たとえば、ある星の光が地球にとどくまでに百年かかるとしたら、いま見ている光は、百年前にその星を出発したことになります。つまり、わたしたちが見上げている夜空は、少しずつちがう時代から届いた光の集まりなのです。もしかすると、もう消えてしまった星の光も、まだ旅を続けているかもしれません。そう考えると、なんだか星空がいっそう不思議に見えてきませんか。',
  'さあ、いよいよ最後の種目、クラス対抗リレーが始まります！ 第一走者がスタートラインにならびました。位置について、よーい、スタート！ 赤組、いいスタートを切りました。白組もぴったりとついていきます。おっと、第二走者へのバトンパス、白組がわずかに前に出たか！ 会場からは大きな声援が送られています。第三コーナーをまわって、両者ほぼならんだまま、いよいよアンカーへ。最後の直線、赤か、白か、どちらもゆずりません。ゴール！ ただいまの結果は、写真判定となります。',
  'みなさん、朝の支度で、こんなことはありませんか。急いでいるのに、なかなかお湯がわかない。そんなときにおすすめなのが、こちらの小さな電気ケトルです。コップ一杯分なら、なんと一分ほどでわきあがります。手のひらにのるほどの大きさなので、せまい台所にもすっきり置けますし、注ぎ口が細いので、コーヒーをいれるときにも、お湯の量を調整しやすいんです。色は、白、黒、それにやさしい若草色の三種類。毎日使うものだからこそ、気に入ったものを選んでみてください。',
  '町の図書館の二階には、窓ぎわにひとつだけ、ひじかけのついた古いいすがあります。わたしは子どものころから、そのいすに座って本を読むのが好きでした。午後になると、窓から差しこむ光が、ちょうどページの上にやわらかくあたるのです。冒険の物語を読んでいると、まわりの静けさが、まるで深い森の中にいるように感じられました。大人になったいまでも、ときどきその図書館をたずねます。いすは少し色あせましたが、座り心地はむかしのままです。本を開くと、あのころの自分に、また会えるような気がします。',
  '引っ越してきて、ちょうど一週間がたちました。段ボールはまだいくつか残っていますが、ようやく自分の部屋らしくなってきました。この町は、駅から少し歩くと、古い商店街があります。八百屋さんのおじさんは声が大きくて、いつも「きょうはこれがおいしいよ」と教えてくれます。言われるままに買ったかぼちゃは、ほくほくで、本当においしかったです。夜は、近くの川ぞいを散歩するのが日課になりました。まだ知り合いは少ないけれど、少しずつ、この町のことが好きになっていく気がします。',
  '雪の結晶は、空の高いところで、小さなちりに水蒸気がくっついてできます。おもしろいのは、そのかたちが、気温や湿度によって変わることです。気温がとても低く、空気がしめっていると、枝がたくさん広がった星のようなかたちになります。反対に、空気が乾いていると、六角形の板や、細い柱のようなかたちになることもあります。ひとつの結晶は、落ちてくるとちゅうで、さまざまな空気の中を通るため、まったく同じかたちのものは、ほとんどないと言われています。次に雪がふったら、黒い手ぶくろの上で、そっと観察してみてください。',
  'その朝、少年は屋根裏部屋で、古い地図を見つけました。黄ばんだ紙には、見たこともない島と、くねくねと曲がった道がえがかれています。地図のすみには、小さな字でこう書かれていました。「星が三つならぶ夜、灯台の下で待て」。少年は、胸がどきどきするのをおさえながら、窓の外を見ました。遠くの海の上に、白い灯台がぽつんと立っています。今夜は、ちょうど満月です。少年は地図をていねいにたたんでポケットにしまうと、ランプと水筒を用意しはじめました。長い長い夜の、始まりでした。',
  '続いては、ラジオネーム、ねこじゃらしさんからのお便りです。「こんばんは。先日、はじめて一人でキャンプに行ってきました。テントを立てるのに一時間もかかってしまい、晩ごはんは真っ暗な中でのカップめんになりました。でも、食べ終わって空を見上げたら、びっくりするほどの星が広がっていて、思わず声が出ました。次は友だちをさそって、ちゃんとカレーを作りたいです」。いいですねえ。失敗もふくめて、ぜんぶがいい思い出になりますよね。ねこじゃらしさん、すてきなお便りをありがとうございました。',
  '山あいの小さな温泉街に着いたのは、日がかたむきはじめたころでした。川にそって木造の宿がいくつもならび、あちこちから白い湯気が立ちのぼっています。宿のおかみさんは「長旅おつかれさまでした」と、あたたかいお茶を出してくれました。夕食の前に、さっそく露天風呂へ向かいます。お湯は少しとろりとしていて、肩までつかると、体のしんからじんわりとほぐれていきました。見上げると、もみじの葉のすきまから、一番星がのぞいています。きょうはもう何も考えずに、ゆっくり休もうと思います。',
  '中学生のころ、わたしは吹奏楽部でトランペットをふいていました。はじめは、まともな音がひとつも出なくて、毎日くちびるがひりひりしたのを覚えています。それでも、先輩が「息を遠くへ飛ばすつもりで」と教えてくれてから、少しずつ音がのびるようになりました。いちばん心に残っているのは、三年生の夏の大会です。本番の前、みんなで輪になって手をつなぎ、目を閉じて深呼吸をしました。結果は銀賞でしたが、演奏が終わった瞬間の拍手は、いまでも耳のおくに残っています。',
  'いまから五十年後の朝を、ちょっと想像してみましょう。目覚まし時計の代わりに、部屋のカーテンが、外の明るさに合わせてゆっくり開きます。台所では小さなロボットが、その日の体調に合わせた朝ごはんを用意してくれています。家を出ると、道路には運転手のいない車が静かに走り、空には荷物を運ぶドローンが行きかっています。でも、もしかすると人は、いまと同じように寝ぼけた顔で歯をみがき、「あと五分だけ」とふとんにもぐりこんでいるかもしれません。便利になっても、変わらないものもきっとありますよね。',
  'お電話ありがとうございます。こちらは、ひまわり町の洋菓子店、こむぎ堂です。ただいま営業時間外のため、お電話に出ることができません。当店の営業時間は、午前十時から午後七時まで、定休日は毎週水曜日となっております。ご予約のケーキは、お受け取りの三日前までにご連絡ください。また今月は、季節限定の、くりとかぼちゃのタルトをご用意しております。数に限りがございますので、お早めにお求めください。ご用件のある方は、発信音のあとに、お名前とお電話番号をお話しください。',
  'ようこそ、旅人さん。ここは、風の谷のはずれにある冒険者の宿です。長い道のり、さぞおつかれでしょう。まずは、あたたかいスープをどうぞ。この谷では最近、夜になると不思議な歌声が聞こえるといううわさがあります。ある者は森の精霊だと言い、ある者は、むかし谷に住んでいた歌い手の幽霊だと言います。もしあなたが真相を確かめてくれるなら、宿代はいただきません。ただし、北の森に入るときは、決して道をはずれないでください。そこから帰ってこられなくなった者も、何人かいるのです。',
  '春になると、近所の川ぞいの道は、一面の桜でうめつくされます。ふだんは静かな道なのに、この季節だけは、朝から夜まで大勢の人でにぎわいます。わたしがいちばん好きなのは、花がちりはじめるころです。風がふくたびに、花びらが雪のように舞いあがり、川の水面をうすいピンク色にそめていきます。その上を、カモの親子がのんびりと泳いでいくのです。満開の桜ももちろんきれいですが、少しさびしげなこの景色を見ると、ああ、また一年がめぐったんだなあと、しみじみ思います。',
  'では、いすに座ったままできる、かんたんなストレッチをしてみましょう。まず、背すじをのばして、両足を床にしっかりつけます。息をゆっくり吸いながら、両手を頭の上に持ち上げてください。そのまま、指先を天井に近づけるように、ぐーっとのびをします。今度は息をはきながら、手をおろしていきましょう。次に、右の肩を前から後ろへ、大きく五回まわします。左の肩も、同じようにまわしてください。最後に、首をゆっくり右へ、左へとかたむけます。どうですか。体が少し、軽くなったような気がしませんか。',
  '次は、地域の話題です。海ぞいの小さな町で、毎年恒例のたこあげ大会が開かれ、子どもからお年寄りまで、およそ三百人が参加しました。会場の砂浜には、魚や鳥、ドラゴンなど、手作りの色あざやかなたこがならび、強い海風を受けて、次々と空へ舞いあがりました。中でも注目を集めたのは、地元の小学生が力を合わせて作った、長さ十メートルのムカデのたこです。うまく風に乗ると、会場からは大きな拍手がわき起こりました。この大会は町の冬の風物詩として親しまれ、今年で四十回目をむかえました。',
  '「ねえ、あしたの遠足、何持っていく？」「おやつは三百円までだよね。わたしは、ラムネとチョコにしようかな」「いいなあ。ぼくは、まだ決まってないんだ。お店に行くと、いつも迷っちゃって」「じゃあ、帰りに一緒に駄菓子屋さんに寄ろうよ。選ぶの、手伝ってあげる」「ほんと？ やったあ！ あ、でも、雨だったらどうなるのかな」「雨なら、体育館でゲーム大会だって。でも、天気予報は晴れだったよ」「よかった。じゃあ今夜は、てるてるぼうずを作っておこうっと」「ふふ、いくつ作るの？」「もちろん、十個！」',
];

export const READINGS_EN: readonly string[] = [
  'The rain that had been falling all night had stopped by morning. When I opened the window, the air smelled of wet earth and grass, and I felt oddly lucky. So I took the long way to the station. In the park, tiny ripples spread across the pond, and a sparrow was washing its wings in a puddle by the bench. The bakery on the corner filled the street with a warm, sweet smell. I walk this road every day, yet today everything felt new. Now and then, a slow morning is exactly what you need.',
  'Good evening, and here is tomorrow’s forecast. Cold air moving down from the north will make tomorrow morning the chilliest of the season so far. During the day, high pressure will bring clear skies to most areas, but clouds will build in the west by evening, with light rain in places overnight. Top temperatures will be three to five degrees lower than today. If you are heading out, take a warm extra layer. The air is also very dry, so please be careful with anything that could catch fire. And that’s the weather for tomorrow.',
  'Long ago, in a small village at the foot of a mountain, there lived a very wise old woman. Whenever the villagers had a problem, they came knocking at her door. One autumn, the village well suddenly began to run dry. Without a word, the old woman climbed the hill behind the village and spent half a day studying the roots of an ancient tree. When she came back, she said, “The water has not run away. It has only lost its way.” The next morning, the villagers moved the stones she showed them, and clear water filled the well once more.',
  'Today I’ll show you how to make a soft, fluffy rolled omelette that anyone can cook. First, crack three eggs into a bowl and add two teaspoons of sugar and a splash of soy sauce. Hold your chopsticks upright and cut through the whites as you mix. Next, warm a frying pan over a medium heat, add a thin layer of oil, and pour in about a third of the egg. When the edges set, roll it from the far side towards you. Push it back, and do the same twice more with the rest. Slice it while it’s hot, and a gentle, sweet smell fills the air.',
  'Thank you for visiting Green Hill Zoo today. Feeding time has just begun at the elephant plaza. Come closer and watch how cleverly they use their trunks to lift apples and carrots into their mouths. At two o’clock this afternoon, our penguins will set off on their daily walk. Watching them waddle along in a neat little line is the most popular event at the zoo. Please remember that feeding the animals is not allowed. Lost children are being looked after at the information desk beside the main gate. We hope you enjoy every moment of your visit.',
  'Dear Grandma, how are you? Autumn has really arrived here, and the mornings and evenings are chilly enough that I need a jacket. Thank you for the apples you sent last week. The whole family loved them. Mum turned some into jam, and I spread it on my toast every morning. At school, we practise singing every day for next month’s concert. At first our voices never matched, but lately there are moments when we all sound like one voice, and that makes me really happy. I’ll come and see you in the winter holidays. Stay warm, and don’t catch a cold.',
  'Most of the stars shining in the night sky make their own light, just like our Sun. They are so far away that they look like tiny dots. Imagine a star whose light takes a hundred years to reach the Earth. The light you see tonight left that star a hundred years ago. In other words, the night sky is a collection of light that has arrived from many different times. Some of it may even come from stars that no longer exist, their light still travelling across space. Doesn’t that make the sky feel even more mysterious?',
  'Here we go, the final event of the day: the class relay! The first runners are on the line. On your marks, get set, go! The red team gets off to a great start, but white is right on their heels. Oh, a smooth handover from white, and they edge ahead! The crowd is on its feet. Round the third bend they come, almost side by side, and now it’s down to the last runners. The final straight, red or white, neither will give an inch. And they cross the line! We’ll have to wait for the photo finish on that one.',
  'Does this ever happen to you? You are rushing to get ready in the morning, and the water just won’t boil. That’s where this little electric kettle comes in. It boils a full cup in about one minute. It is small enough to sit in the palm of your hand, so it fits neatly into even the tiniest kitchen. The narrow spout makes it easy to pour exactly the right amount when you make coffee. It comes in white, black, and a soft spring green. It’s something you will use every day, so why not choose one you really love?',
  'On the second floor of our town library, there is one old armchair by the window. Ever since I was a child, I have loved reading in that chair. In the afternoon, the sunlight falls softly right across the page. When I read adventure stories there, the quiet around me felt like the stillness of a deep forest. Even now, as an adult, I still go back from time to time. The chair has faded a little, but it is just as comfortable as ever. When I open a book there, I feel as if I might meet my younger self again.',
  'It has been exactly one week since I moved here. A few boxes are still unpacked, but my room is finally starting to feel like mine. A short walk from the station, there is an old shopping street. The man at the greengrocer’s has a big, booming voice, and he always tells me what’s best today. The pumpkin he talked me into buying was soft, sweet, and delicious. A walk along the river at night has become part of my routine. I don’t know many people yet, but little by little, I think I’m falling for this town.',
  'Snow crystals form high in the sky, when water vapour clings to tiny specks of dust. What’s interesting is that their shape changes with the temperature and the humidity. When it is very cold and the air is damp, they grow into stars with many branching arms. When the air is dry, they may become flat hexagons or thin little columns instead. Each crystal passes through many layers of air on its way down, so it is said that almost no two are exactly alike. Next time it snows, catch a few on a dark glove and take a close look.',
  'That morning, the boy found an old map in the attic. On the yellowed paper were an island he had never seen and a road that twisted and turned. In one corner, in tiny letters, someone had written: “On the night three stars line up, wait beneath the lighthouse.” Trying to calm his pounding heart, the boy looked out of the window. Far out at sea, a white lighthouse stood alone. Tonight, the moon would be full. He folded the map carefully, slipped it into his pocket, and began to pack a lamp and a water bottle. It was the start of a very long night.',
  'Next up, a letter from a listener who goes by the name Foxtail. “Good evening. The other day, I went camping on my own for the first time. It took me a whole hour to put up the tent, so dinner ended up being instant noodles in the pitch dark. But when I finished eating and looked up, the sky was so full of stars that I gasped out loud. Next time I’ll bring some friends and make a proper curry.” How lovely. Even the mistakes turn into good memories, don’t they? Thank you, Foxtail, for such a wonderful letter.',
  'The sun was starting to set when I reached the little hot-spring town in the mountains. Wooden inns lined the river, and white steam rose here and there. The owner of the inn welcomed me with a cup of warm tea and said, “You must be tired after such a long trip.” Before dinner, I headed straight for the outdoor bath. The water felt soft and silky, and as I sank in up to my shoulders, I could feel myself slowly unwind. Through the maple leaves, the first star of the evening was peeking out. Tonight, I’m going to rest and think about nothing at all.',
  'In junior high, I played the trumpet in the school band. At first, I couldn’t make a single decent note, and I remember my lips stinging every day. But after an older student told me to imagine sending my breath far away, my sound slowly began to carry. What I remember most is the summer contest in my final year. Before we went on stage, we stood in a circle, held hands, closed our eyes, and took a deep breath together. We won a silver prize, but the applause when we finished playing still rings in my ears.',
  'Let’s imagine a morning fifty years from now. Instead of an alarm clock, the curtains slowly open as the light outside grows brighter. In the kitchen, a small robot prepares a breakfast that suits how you are feeling that day. Outside, cars with no drivers glide quietly down the road, and delivery drones criss-cross the sky. And yet, people might still brush their teeth with sleepy faces and crawl back under the covers, saying, “Just five more minutes.” However convenient life becomes, some things probably never change, do they?',
  'Thank you for calling Komugi-do, the cake shop in Sunflower Town. We’re sorry, but we are closed at the moment and cannot take your call. We are open from ten in the morning until seven in the evening, and closed every Wednesday. If you would like to order a cake, please let us know at least three days before you collect it. This month, we also have a seasonal chestnut and pumpkin tart. Numbers are limited, so please come early. If you would like to leave a message, please say your name and phone number after the tone.',
  'Welcome, traveller. This is the adventurers’ inn at the edge of the Valley of Winds. You must be weary from the long road, so please, have some warm soup first. Lately, there have been rumours of a strange singing voice heard in the valley at night. Some say it is a forest spirit. Others say it is the ghost of a singer who once lived here. If you can find out the truth, your stay will be free of charge. But when you enter the northern forest, never leave the path. More than a few have gone in and never come back.',
  'In spring, the path along the river near my home is covered in cherry blossoms. It is usually a quiet road, but in this season it is busy with people from morning until night. My favourite time is when the petals begin to fall. Every time the wind blows, they swirl up like snow and tint the surface of the river a pale pink. A family of ducks paddles lazily through them. The trees in full bloom are beautiful, of course, but when I see this slightly lonely scene, I feel deeply that another year has come around again.',
  'Let’s try a simple stretch you can do while sitting in your chair. First, sit up straight and put both feet flat on the floor. Breathe in slowly as you raise both hands above your head. Now reach your fingertips up towards the ceiling and stretch, stretch, stretch. Breathe out as you lower your hands again. Next, roll your right shoulder from front to back in five big circles. Do the same with your left shoulder. Finally, gently tilt your head to the right, and then to the left. How does that feel? A little lighter, maybe?',
  'And now for some local news. A small seaside town held its yearly kite festival, with about three hundred people taking part, from young children to grandparents. Colourful handmade kites shaped like fish, birds, and dragons lined the beach and rose one after another into the strong sea breeze. The kite that drew the most attention was a ten-metre centipede, made by local primary school pupils working together. When it finally caught the wind, the crowd burst into applause. This year marked the fortieth festival, now a much-loved part of winter in the town.',
  '“Hey, what are you bringing on the school trip tomorrow?” “We can bring snacks up to three hundred yen, right? I think I’ll get some fizzy sweets and chocolate.” “Lucky you. I still haven’t decided. Whenever I go to the shop, I just can’t choose.” “Then let’s stop at the sweet shop together on the way home. I’ll help you pick.” “Really? Yes! Oh, but what happens if it rains?” “If it rains, we’ll have a games day in the gym. But the forecast said sunny.” “Phew. Then tonight I’ll make a little sunshine doll for the window.” “How many are you making?” “Ten, of course!”',
];

/** お題の文（今の言葉で） */
export const promptText = (i: number): string => (lang === 'en' ? PROMPTS_EN : PROMPTS)[i % PROMPTS.length]!;
/** 決まった文（今の言葉で） */
export const readingText = (i: number): string => (lang === 'en' ? READINGS_EN : READINGS)[i % READINGS.length]!;

/** count 個の中からランダムに 1 つの番号（前と同じ物は避ける） */
export function nextIndex(count: number, prev: number | null, random: () => number = Math.random): number {
  if (count < 2) return 0;
  for (;;) {
    const i = Math.floor(random() * count);
    if (i !== prev) return i;
  }
}
/** お題の番号（ランダム。前と同じ物は避ける） */
export const nextPromptIndex = (prev: number | null, random?: () => number): number => nextIndex(PROMPTS.length, prev, random);
/** 決まった文の番号（ランダム。前と同じ物は避ける） */
export const nextReadingIndex = (prev: number | null, random?: () => number): number => nextIndex(READINGS.length, prev, random);
