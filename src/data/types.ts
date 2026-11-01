// データの形（data/ の JSON）。名前・リンク・数字だけで、音・画像は入れない。
import type { Features } from '../voice/features.ts';

/** data/catalog.json の 1 つのお手本の声（VTuber・配信者・キャラなど） */
export interface CatalogEntry {
  /** 決まった ID（例 "v-0001"） */
  id: string;
  /** 画面に出す名前 */
  name: string;
  /** 所属や作品名（任意。画面で名前と一緒に出す） */
  group?: string;
  links: {
    /** 公式のページ（プロフィールなど） */
    profile: string;
    /** 測ったチャンネル（任意） */
    channel?: string;
  };
  /** 利用者の登録から出した声（data/user-catalog.json。tools/intake.ts が作る）。無ければ運営が拡張機能で測った声 */
  by?: 'users';
}

export interface Catalog {
  version: 1;
  voices: CatalogEntry[];
}

/** 拡張機能が書き出す、30 秒ごとの 1 つの窓 */
export interface VoiceWindow {
  /** YouTube の動画 ID など */
  video: string;
  /** 動画の中の時刻（秒） */
  t0: number;
  t1: number;
  /** 測った日（YYYY-MM-DD） */
  measuredAt: string;
  /** measure.ts の MEASURE_VERSION */
  version: string;
  features: Features;
  /** 選別に使う目印（measure.ts の info の一部） */
  voicedSeconds: number;
  gapTonal: number;
  snrDb: number;
}

/** data/voices/<id>.json */
export interface VoiceFile {
  id: string;
  windows: VoiceWindow[];
}

/** data/profiles.json の 1 つの声（tools/build-voices.ts が作る）。data/user-profiles.json（tools/intake.ts）も同じ形 */
export interface ProfileEntry {
  id: string;
  version: string;
  /** 使った窓と動画の数（利用者の登録では、使った登録の数と 0） */
  windows: number;
  videos: number;
  /** 項目ごとの中央値 */
  features: Features;
}

export interface ProfileList {
  version: string;
  profiles: ProfileEntry[];
}
