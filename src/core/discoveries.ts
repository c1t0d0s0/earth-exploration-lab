/**
 * 「今週の地球の発見」を最新データから作るための計算（データ取得とは分離した純粋な関数）。
 * 格子は全球の等緯度経度 (EPSG:4326)：bbox=[-180,-90,180,90]、左上から右下へ並ぶ。
 */
import { isValid } from "./stats";

export interface Grid {
  width: number;
  height: number;
  data: ArrayLike<number>;
  /** [西, 南, 東, 北] */
  bbox: [number, number, number, number];
}

/** ピクセル中心の経度緯度 */
export function pixelLonLat(g: Grid, i: number, j: number): [number, number] {
  const [w, s, e, n] = g.bbox;
  return [w + ((i + 0.5) / g.width) * (e - w), n - ((j + 0.5) / g.height) * (n - s)];
}

/** 欠損を除いた複数グリッドの合計（すべての時点が欠損のピクセルは NaN）。scale を掛けて足す */
export function sumGrids(grids: Grid[], scale = 1): Grid {
  if (!grids.length) throw new Error("grids is empty");
  const { width, height, bbox } = grids[0];
  const out = new Float32Array(width * height).fill(NaN);
  for (const g of grids) {
    if (g.width !== width || g.height !== height) throw new Error("grid size mismatch");
    for (let k = 0; k < out.length; k++) {
      const v = g.data[k];
      if (!isValid(v)) continue;
      out[k] = (Number.isNaN(out[k]) ? 0 : out[k]) + v * scale;
    }
  }
  return { width, height, bbox, data: out };
}

export interface Peak {
  lon: number;
  lat: number;
  /** 周囲 (2r+1)^2 ピクセルの平均値（有効値のみ） */
  value: number;
}

/**
 * 周囲の平均（ノイズ除去）が最大になる地点。
 * 有効なピクセルが周囲の半分未満の場所は対象外（海岸の1点だけの値などを避ける）。
 * 経度方向は日付変更線をまたいでつなげる。
 */
export function findPeak(g: Grid, r = 1, latRange: [number, number] = [-90, 90]): Peak | null {
  let best: Peak | null = null;
  const need = Math.ceil(((2 * r + 1) ** 2) / 2);
  for (let j = r; j < g.height - r; j++) {
    const lat = pixelLonLat(g, 0, j)[1];
    if (lat < latRange[0] || lat > latRange[1]) continue;
    for (let i = 0; i < g.width; i++) {
      const c = g.data[i + j * g.width];
      if (!isValid(c)) continue;
      let s = 0;
      let n = 0;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          const ii = (i + di + g.width) % g.width;
          const v = g.data[ii + (j + dj) * g.width];
          if (isValid(v)) {
            s += v;
            n++;
          }
        }
      }
      if (n < need) continue;
      const m = s / n;
      if (!best || m > best.value) {
        const [lon, lt] = pixelLonLat(g, i, j);
        best = { lon, lat: lt, value: m };
      }
    }
  }
  return best;
}

export interface PairedDiff {
  meanA: number;
  meanB: number;
  /** B − A */
  diff: number;
  /** 比較に使えたピクセルの割合 */
  coverage: number;
}

/**
 * 2つの時点で両方とも値がある場所だけを使い、面積（cos 緯度）で重み付けした平均を比べる。
 * 雲などで欠損の場所が時点ごとに違っても、同じ場所どうしで比べられる。
 */
export function pairedAreaMeanDiff(a: Grid, b: Grid, latRange: [number, number] = [-90, 90]): PairedDiff | null {
  if (a.width !== b.width || a.height !== b.height) throw new Error("grid size mismatch");
  let sw = 0;
  let sa = 0;
  let sb = 0;
  let pairs = 0;
  let total = 0;
  for (let j = 0; j < a.height; j++) {
    const lat = pixelLonLat(a, 0, j)[1];
    if (lat < latRange[0] || lat > latRange[1]) continue;
    const w = Math.cos((lat * Math.PI) / 180);
    for (let i = 0; i < a.width; i++) {
      total++;
      const va = a.data[i + j * a.width];
      const vb = b.data[i + j * b.width];
      if (!isValid(va) || !isValid(vb)) continue;
      sw += w;
      sa += va * w;
      sb += vb * w;
      pairs++;
    }
  }
  if (!pairs || sw === 0) return null;
  return { meanA: sa / sw, meanB: sb / sw, diff: (sb - sa) / sw, coverage: pairs / total };
}

export interface ExtentChange {
  countA: number;
  countB: number;
  /** B / A */
  ratio: number;
}

/**
 * しきい値以上のピクセル数を2時点で比べる（両時点とも値のある場所だけ）。
 * 海氷の「範囲（密接度15%以上）」の比較に使う。面積の重みは考慮しないおおよその比較。
 */
export function extentChange(a: ArrayLike<number>, b: ArrayLike<number>, threshold: number): ExtentChange | null {
  if (a.length !== b.length) throw new Error("length mismatch");
  let ca = 0;
  let cb = 0;
  for (let k = 0; k < a.length; k++) {
    const va = a[k];
    const vb = b[k];
    if (!isValid(va) || !isValid(vb)) continue;
    if (va >= threshold) ca++;
    if (vb >= threshold) cb++;
  }
  if (!ca) return null;
  return { countA: ca, countB: cb, ratio: cb / ca };
}

/** 増減を表す言葉（小さな差は「ほぼ同じ」とする） */
export function changeWord(diff: number, epsilon: number, up = "高い", down = "低い"): string {
  if (Math.abs(diff) < epsilon) return "ほぼ同じ";
  return diff > 0 ? up : down;
}

/** 東京の年間降水量の平年値（気象庁 1991〜2020年の平年値 1598.2mm） */
export const TOKYO_ANNUAL_PRECIP_MM = 1598.2;
