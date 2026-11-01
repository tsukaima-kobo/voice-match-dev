// GitHub のスターの数（サイトを作る時に tools/github-stars.ts が data/generated/github.json に書いた物）。
// 見ている人のブラウザーは GitHub に何も問い合わせない。無ければ null（数を出さない）。
const files = import.meta.glob<{ default: { stars?: number } }>('../../data/generated/github.json', { eager: true });

export default function githubStars(): number | null {
  const n = files['../../data/generated/github.json']?.default?.stars;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
