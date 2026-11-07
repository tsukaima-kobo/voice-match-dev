// しくみと約束のページ（about.html）: 言葉の切り替え（JP / EN）だけ。ページの文は、HTML に両方の言葉で書いてある。
import { mountLang } from '../i18n.ts';
import { githubUrl, SITE } from '../site-config.ts';
import { mountFooter, mountGithubLink } from './share.ts';

mountLang({ ja: 'しくみと約束｜voice-match', en: 'How it works | voice-match' });
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
// (削除のお願いの窓口: 住所は site-config.ts の 1 か所だけ)
const setHref = (id: string, href: string) => {
  const a = document.getElementById(id) as HTMLAnchorElement | null;
  if (a) a.href = href;
};
setHref('removal-form', SITE.removal.form);
setHref('removal-mail', `mailto:${SITE.removal.email}`);
setHref('removal-issue', `${githubUrl(SITE.removal.issues) ?? 'https://github.com'}/issues/new?template=removal.yml`);
