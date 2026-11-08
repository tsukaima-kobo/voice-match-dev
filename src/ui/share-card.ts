// 共有カード: X などに載せる 1 枚の絵（1080×1350 の縦長。いつも夜の色）。結果だけを載せ、音・名前などの個人の情報は載せない。
//   声のページ: 「あなたの声に近いのは」と 1 位の声の名前・近さの言葉、あなたの声紋、目立つ数字 4 つ、サイトの住所。
//   声真似の点数: お手本の名前・点数・点数の言葉、お手本とあなたの声紋、サイトの住所。
// 声紋は voiceprint.ts の renderSnapshot（決まった時刻の 1 枚。同じ数字なら同じ絵）。
import { formatFeature, FEATURE_BY_KEY, type FeatureKey, type Features } from '../voice/features.ts';
import { renderSnapshot } from './voiceprint.ts';
import { SITE } from '../site-config.ts';
import { t } from '../i18n.ts';

export const CARD_W = 1080,
  CARD_H = 1350;

export type CardData =
  | { kind: 'voice'; features: Features; top?: { name: string; word: string }; certainty?: string }
  | { kind: 'mimic'; features: Features; model: { name: string; features: Features }; score: number; word: string; line: boolean };

const FONT = () => (typeof document !== 'undefined' ? getComputedStyle(document.body).fontFamily : 'sans-serif');
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** 幅に収まるまで字を小さくして書く（中央・左・右） */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight = 800, align: CanvasTextAlign = 'left', family = FONT()): number {
  let s = size;
  for (;;) {
    ctx.font = `${weight} ${s}px ${family}`;
    if (ctx.measureText(text).width <= maxW || s <= 18) break;
    s -= 2;
  }
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  return s;
}

/** 角の丸い四角の道筋。roundRect の無いブラウザー（Safari 15 まで など）では arcTo で描く */
export function roundRect(ctx: Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'arcTo' | 'closePath'> & { roundRect?: CanvasRenderingContext2D['roundRect'] }, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

export function drawCard(d: CardData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CARD_W;
  c.height = CARD_H;
  const ctx = c.getContext('2d')!;
  const W = CARD_W,
    H = CARD_H;

  // 夜の地と、オーロラ
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d0b1d');
  bg.addColorStop(1, '#07060f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const blob = (x: number, y: number, r: number, col: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  blob(120, 80, 620, 'rgba(240, 71, 143, 0.30)');
  blob(1000, 260, 680, 'rgba(122, 77, 255, 0.34)');
  blob(560, 1360, 700, 'rgba(98, 216, 236, 0.22)');
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  roundRect(ctx, 28, 28, W - 56, H - 56, 44);
  ctx.stroke();

  // 上: ロゴと名前
  const grad = ctx.createLinearGradient(80, 0, 520, 0);
  grad.addColorStop(0, '#ff6fa8');
  grad.addColorStop(0.55, '#a98bff');
  grad.addColorStop(1, '#6fe0f0');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(98, 104, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f3f0fb';
  ctx.textBaseline = 'middle';
  ctx.font = `800 44px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText('voice-match', 136, 106);
  ctx.fillStyle = 'rgba(243,240,251,0.6)';
  ctx.font = `700 28px ${FONT()}`;
  ctx.textAlign = 'right';
  ctx.fillText(t('声真似練習場', 'Voice-mimic studio'), W - 80, 106);

  ctx.textBaseline = 'alphabetic';
  if (d.kind === 'voice') {
    // 見出し
    ctx.fillStyle = 'rgba(243,240,251,0.72)';
    fitText(ctx, d.top ? t('あなたの声に近いのは', 'Your voice is closest to') : t('あなたの声紋', 'Your voiceprint'), 80, 218, W - 160, 38, 700);
    if (d.top) {
      ctx.fillStyle = grad;
      const big = fitText(ctx, d.top.name, 80, 318, W - 160, 92, 900);
      ctx.fillStyle = 'rgba(243,240,251,0.85)';
      fitText(ctx, `${d.top.word}${d.certainty ? t(` ・確かさ ${d.certainty}`, ` · certainty: ${d.certainty}`) : ''}`, 80, 318 + Math.min(70, big * 0.8), W - 160, 34, 700);
    } else if (d.certainty) {
      ctx.fillStyle = 'rgba(243,240,251,0.85)';
      fitText(ctx, t(`確かさ: ${d.certainty}`, `Certainty: ${d.certainty}`), 80, 290, W - 160, 34, 700);
    }
    // 声紋
    const size = 690;
    ctx.drawImage(renderSnapshot(d.features, size), (W - size) / 2, 405, size, size);
    // 目立つ数字 4 つ
    const keys: FeatureKey[] = ['pitch', 'centroid', 'hnr', 'pitchRange'];
    const items = keys.filter((k) => d.features[k] !== null).slice(0, 4);
    const cw = (W - 160 - 3 * 16) / 4;
    items.forEach((k, i) => {
      const x = 80 + i * (cw + 16),
        y = 1108;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      roundRect(ctx, x, y, cw, 104, 22);
      ctx.fill();
      ctx.fillStyle = 'rgba(243,240,251,0.6)';
      fitText(ctx, FEATURE_BY_KEY[k].name, x + 20, y + 38, cw - 40, 24, 700);
      ctx.fillStyle = '#f3f0fb';
      fitText(ctx, formatFeature(k, d.features[k]), x + 20, y + 82, cw - 40, 34, 800, 'left', MONO);
    });
  } else {
    ctx.fillStyle = 'rgba(243,240,251,0.72)';
    fitText(ctx, d.model.name ? t(`「${d.model.name}」の声真似${d.line ? '（セリフ）' : ''}`, `Imitating “${d.model.name}”${d.line ? ' (line)' : ''}`) : t(`声真似の点数${d.line ? '（セリフ）' : ''}`, `Mimic score${d.line ? ' (line)' : ''}`), 80, 218, W - 160, 38, 700);
    ctx.fillStyle = grad;
    ctx.font = `900 170px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.fillText(String(d.score), 76, 380);
    const sw = ctx.measureText(String(d.score)).width;
    ctx.fillStyle = 'rgba(243,240,251,0.7)';
    ctx.font = `800 44px ${FONT()}`;
    ctx.fillText(t('点', 'pts'), 76 + sw + 14, 380);
    ctx.fillStyle = '#f3f0fb';
    fitText(ctx, d.word, 80, 450, W - 160, 52, 900);
    // お手本とあなたの声紋
    const size = 470;
    const y = 520;
    ([
      [t('お手本', 'Model'), d.model.features, 70],
      [t('あなた', 'You'), d.features, W - 70 - size],
    ] as const).forEach(([label, f, x]) => {
      ctx.drawImage(renderSnapshot(f, size), x, y, size, size);
      ctx.fillStyle = 'rgba(243,240,251,0.8)';
      fitText(ctx, label, x + size / 2, y + size + 46, size, 34, 800, 'center');
    });
    ctx.fillStyle = 'rgba(243,240,251,0.55)';
    fitText(ctx, t('同じ数字なら、いつも同じ模様。模様が似るほど、声も似ています。', 'Same numbers, same pattern. The more alike the patterns, the more alike the voices.'), W / 2, 1140, W - 160, 28, 600, 'center');
  }

  // 下: サイトの住所とハッシュタグ
  ctx.fillStyle = 'rgba(243,240,251,0.55)';
  fitText(ctx, SITE.url.replace(/^https:\/\//, '').replace(/\/$/, ''), 80, H - 98, W - 160, 28, 700, 'left', MONO);
  ctx.fillStyle = 'rgba(243,240,251,0.4)';
  fitText(ctx, SITE.hashtags.map((h) => `#${h}`).join('  '), 80, H - 58, W - 160, 26, 700, 'left');
  return c;
}
