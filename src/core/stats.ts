export type Num = number | null | undefined;

export function isValid(v: Num): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function mean(values: ArrayLike<Num>): number | null {
  let s = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isValid(v)) {
      s += v;
      n++;
    }
  }
  return n ? s / n : null;
}

export interface Correlation {
  r: number;
  n: number;
  slope: number;
  intercept: number;
}

/** ピアソンの相関係数と回帰直線。欠損を含む組は除外する。有効な組が3未満なら null */
export function pearson(xs: Num[], ys: Num[]): Correlation | null {
  const px: number[] = [];
  const py: number[] = [];
  const len = Math.min(xs.length, ys.length);
  for (let i = 0; i < len; i++) {
    const x = xs[i];
    const y = ys[i];
    if (isValid(x) && isValid(y)) {
      px.push(x);
      py.push(y);
    }
  }
  const n = px.length;
  if (n < 3) return null;
  const mx = px.reduce((a, b) => a + b, 0) / n;
  const my = py.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = px[i] - mx;
    const dy = py[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  const slope = sxy / sxx;
  return { r: sxy / Math.sqrt(sxx * syy), n, slope, intercept: my - slope * mx };
}

/** 相関係数の大きさを、子供にもわかる言葉で表す */
export function describeCorrelation(r: number): { label: string; plain: string } {
  const a = Math.abs(r);
  const dir = r >= 0 ? "正" : "負";
  if (a >= 0.7) {
    return {
      label: `強い${dir}の相関`,
      plain: r >= 0 ? "一方が増えると、もう一方もはっきり増える傾向があります。" : "一方が増えると、もう一方ははっきり減る傾向があります。",
    };
  }
  if (a >= 0.4) {
    return {
      label: `中程度の${dir}の相関`,
      plain: r >= 0 ? "一方が増えると、もう一方もやや増える傾向があります。" : "一方が増えると、もう一方はやや減る傾向があります。",
    };
  }
  if (a >= 0.2) return { label: `弱い${dir}の相関`, plain: "わずかに関係がありそうですが、はっきりとは言えません。" };
  return { label: "ほとんど相関なし", plain: "2つのデータの増え方・減り方には、はっきりした関係が見られません。" };
}

/** 日付キーで2つの系列をそろえる */
export function alignByKey<T extends { key: string; value: Num }>(a: T[], b: T[]): { keys: string[]; xs: Num[]; ys: Num[] } {
  const mb = new Map(b.map((p) => [p.key, p.value]));
  const keys: string[] = [];
  const xs: Num[] = [];
  const ys: Num[] = [];
  for (const p of a) {
    if (mb.has(p.key)) {
      keys.push(p.key);
      xs.push(p.value);
      ys.push(mb.get(p.key));
    }
  }
  return { keys, xs, ys };
}

/** 配列から最大 max 個を等間隔に間引く（先頭と末尾は必ず含む） */
export function sampleEvenly<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr.slice();
  if (max <= 1) return [arr[arr.length - 1]];
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(arr[Math.round((i * (arr.length - 1)) / (max - 1))]);
  }
  return out;
}

/** 数値を見やすい桁数で整形する */
export function formatNumber(v: number | null | undefined, digits?: number): string {
  if (!isValid(v)) return "—";
  const a = Math.abs(v);
  const d = digits ?? (a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3);
  return v.toLocaleString("ja-JP", { maximumFractionDigits: d, minimumFractionDigits: 0 });
}
