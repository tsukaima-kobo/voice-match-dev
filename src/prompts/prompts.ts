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

/** 決まった文（同じ文で比べたい時に。このサイト用に書いた文） */
export const READING =
  'きょうは朝から雨でしたが、昼すぎには青空が見えてきました。駅前のパン屋さんで、焼きたてのメロンパンを二つ買いました。あなたは、どんなパンが好きですか？ わたしは、外がさくっとしていて、中がふわふわのパンが好きです。';
export const READING_EN =
  'It rained all morning, but by the afternoon the sky had turned blue again. I stopped at the bakery by the station and bought two warm rolls, still soft from the oven. What kind of bread do you like? I like the kind that is crisp on the outside and fluffy in the middle.';

/** お題の文（今の言葉で） */
export const promptText = (i: number): string => (lang === 'en' ? PROMPTS_EN : PROMPTS)[i % PROMPTS.length]!;
/** 決まった文（今の言葉で） */
export const readingText = (): string => (lang === 'en' ? READING_EN : READING);

/** ランダムに 1 つの番号（前と同じ物は避ける） */
export function nextPromptIndex(prev: number | null, random: () => number = Math.random): number {
  if (PROMPTS.length < 2) return 0;
  for (;;) {
    const i = Math.floor(random() * PROMPTS.length);
    if (i !== prev) return i;
  }
}
