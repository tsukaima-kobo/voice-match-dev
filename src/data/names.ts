// 画面に出す声の名前と所属。英語のページでは、英語名があればそれを出し、無ければ日本語のまま。
// 名前は、ページをまたぐリンク（?target=）・同じ声を見分ける鍵には、いつも日本語の name を使う。
import { lang, type Lang } from '../i18n.ts';

export const nameOf = (v: { name: string; nameEn?: string | undefined }, l: Lang = lang): string => (l === 'en' && v.nameEn) || v.name;

export const groupOf = (v: { group?: string | undefined; groupEn?: string | undefined }, l: Lang = lang): string | undefined => (l === 'en' && v.groupEn) || v.group;
