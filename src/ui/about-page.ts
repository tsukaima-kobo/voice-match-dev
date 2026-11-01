// しくみと約束のページ（about.html）: 言葉の切り替え（JP / EN）だけ。ページの文は、HTML に両方の言葉で書いてある。
import { mountLang } from '../i18n.ts';

mountLang({ ja: 'しくみと約束｜voice-twin', en: 'How it works | voice-twin' });
