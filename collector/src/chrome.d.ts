// 拡張機能で使う chrome の API だけの型（@types/chrome を入れないため）
declare namespace chrome {
  namespace runtime {
    /** 拡張機能が読み直された後の古いページでは無くなる */
    const id: string | undefined;
    function getURL(path: string): string;
  }
  namespace storage {
    const local: {
      get(keys: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
  }
}
