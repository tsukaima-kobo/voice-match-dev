// 測り方の版を比べる（"3.1.0" より "3.2.0" が新しい）。DOM なし・ファイルの読み書きなし。
// いくつかの版の数字から作った代表値には、いちばん古い版を書く。前の版を MEASURE_COMPATIBLE から外した時に、
// その版の数字が混ざった物を「今の版」として使い続けないため（readableVersion で止まるように）。

/** 版の前後（a が古ければ負・同じなら 0・新しければ正）。数の所は数として比べる */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const d = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0;
    if (d) return d;
  }
  return 0;
}

/** いちばん古い版。1 つも無ければ fallback */
export function oldestVersion(versions: Iterable<string>, fallback: string): string {
  let out: string | undefined;
  for (const v of versions) if (out === undefined || compareVersions(v, out) < 0) out = v;
  return out ?? fallback;
}
