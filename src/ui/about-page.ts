// しくみと約束のページ（about.html）: 言葉の切り替え（JP / EN）だけ。ページの文は、HTML に両方の言葉で書いてある。
import { mountLang } from '../i18n.ts';
import { githubUrl } from '../site-config.ts';
import { mountFooter, mountGithubLink } from './share.ts';

mountLang({ ja: 'しくみと約束｜voice-twin', en: 'How it works | voice-twin' });
mountGithubLink();
mountFooter();
// (オープンソースの節: GitHub のリポジトリが設定されてから出す)
const gh = githubUrl();
const oss = document.getElementById('oss');
const link = document.getElementById('oss-link') as HTMLAnchorElement | null;
if (gh && oss && link) {
  oss.hidden = false;
  link.href = gh;
}
