// データの形（data/ の JSON）。名前・リンク・数字だけで、音・画像は入れない。
import type { Features } from '../voice/features.ts';

/** data/catalog.json の 1 つのお手本の声（VTuber・配信者・キャラなど） */
export interface CatalogEntry {
  /** 決まった ID（例 "v-0001"）。サイトを作る時だけ使い、サイトのデータには入れない（src/data/pack.ts） */
  id: string;
  /** 画面に出す名前 */
  name: string;
  /** 所属や作品名（任意。画面で名前と一緒に出す） */
  group?: string;
  /** 大枠（VTuber・歌手など。src/data/kinds.ts の ID。いくつでも。無い声は「すべて」の中でだけ出る） */
  kinds?: string[];
  links: {
    /** 公式のページ（プロフィールなど） */
    profile: string;
    /** 測ったチャンネル（任意） */
    channel?: string;
  };
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

/**
 * 運営が測った声の代表値（1 人 1 件）。リポジトリにはコミットせず、GitHub の Release「voices-data」に
 * operator-voices.json として置く。tools/voices-release.ts が作って置き、サイトを作る時に data/generated/ へ取ってくる。
 * Release は公開なので、サイトと同じく名前・所属・大枠・公式ページ・数字だけ（人物ID や窓の数は入れない）。
 */
export interface OperatorVoices {
  version: 1;
  /** 測り方の版（MEASURE_VERSION） */
  measureVersion: string;
  voices: {
    name: string;
    /** 今の所属や作品名 */
    group?: string;
    /** 大枠（src/data/kinds.ts の ID） */
    kinds?: string[];
    /** 公式のページ */
    link: string;
    features: Features;
  }[];
}
