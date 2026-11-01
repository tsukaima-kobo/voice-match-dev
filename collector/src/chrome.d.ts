// 拡張機能で使う chrome の API だけの型（@types/chrome を入れないため）
declare namespace chrome {
  namespace runtime {
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
