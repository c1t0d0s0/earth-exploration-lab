/** 地球データランキングの集計（データ取得とは分離した純粋な関数） */
import raw from "../data/rankings.json";
import { pixelLonLat, smoothGrid, type Grid } from "./discoveries";
import { isValid } from "./stats";

export type Metric = "mean" | "sum" | "range";
export type Transform = "precip-month-total" | "kelvin-to-celsius";

export interface DisplayRange {
  min: number;
  max: number;
  colors: string | string[];
}

interface Base {
  id: string;
  title: string;
  icon: string;
  dataset: string;
  valueLabel: string;
  unitLabel: string;
  aggregation: string;
  area: string;
  description: string;
  caution: string;
}

export interface GridRanking extends Base {
  type: "grid";
  metric: Metric;
  transform?: Transform;
  monthUnitLabel?: string;
  yearOnly?: boolean;
  latRange: [number, number];
  /** 周囲3×3区画のうち、データのある区画の割合の下限（海面水温で内陸の川・湖を除くため等） */
  minCoverage?: number;
  display: DisplayRange;
  monthDisplay?: DisplayRange;
}

export interface SeasRanking extends Base {
  type: "seas";
  seas: { name: string; bbox: [number, number, number, number] }[];
}

export type RankingDef = GridRanking | SeasRanking;

export const RANKINGS: RankingDef[] = (raw as unknown as { rankings: RankingDef[] }).rankings;

export function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** 1か月分の格子の値を、ランキング用の値に変換する */
export function transformValue(v: number, t: Transform | undefined, year: number, month0: number): number {
  if (!isValid(v)) return NaN;
  if (t === "precip-month-total") return v * 24 * daysInMonth(year, month0);
  if (t === "kelvin-to-celsius") return v - 273.15;
  return v;
}

/**
 * 複数の月の格子を1つに集計する。
 * minValid 未満の月しかデータがないピクセルは欠損にする。
 * sum は欠けた月を平均で補って12か月分に換算する（雲などで1〜2か月欠けても年合計を比べられるように）。
 */
export function aggregateMonths(grids: Grid[], metric: Metric, minValid: number): Grid {
  if (!grids.length) throw new Error("grids is empty");
  const { width, height, bbox } = grids[0];
  const out = new Float32Array(width * height).fill(NaN);
  for (let k = 0; k < out.length; k++) {
    let n = 0;
    let s = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const g of grids) {
      const v = g.data[k];
      if (!isValid(v)) continue;
      n++;
      s += v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (n < minValid) continue;
    out[k] = metric === "mean" ? s / n : metric === "sum" ? (s / n) * grids.length : hi - lo;
  }
  return { width, height, bbox, data: out };
}

/** 2地点間の大円距離（km） */
export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface RankedRegion {
  rank: number;
  lon: number;
  lat: number;
  value: number;
}

/**
 * 周囲3°の平均で値の大きい順に並べ、すでに選んだ地域から minSepKm 以内のものは除いて上位 n 件を選ぶ
 * （同じ地域の隣り合う区画ばかりが並ばないように）。
 */
export function topRegions(g: Grid, n: number, latRange: [number, number], minSepKm = 1500, minCoverage = 0.5): RankedRegion[] {
  const sm = smoothGrid(g, 1);
  if (minCoverage > 0.5) {
    // 周囲にデータのない区画が多い場所（海に対する内陸の湖や川など）を除く
    for (let j = 0; j < g.height; j++) {
      for (let i = 0; i < g.width; i++) {
        let c = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= g.height) continue;
          for (let di = -1; di <= 1; di++) if (isValid(g.data[((i + di + g.width) % g.width) + jj * g.width])) c++;
        }
        if (c / 9 < minCoverage) (sm.data as Float32Array)[i + j * g.width] = NaN;
      }
    }
  }
  const cells: { lon: number; lat: number; value: number }[] = [];
  for (let j = 0; j < sm.height; j++) {
    const lat = pixelLonLat(sm, 0, j)[1];
    if (lat < latRange[0] || lat > latRange[1]) continue;
    for (let i = 0; i < sm.width; i++) {
      const v = sm.data[i + j * sm.width];
      if (isValid(v)) cells.push({ lon: pixelLonLat(sm, i, j)[0], lat, value: v });
    }
  }
  cells.sort((a, b) => b.value - a.value);
  const out: RankedRegion[] = [];
  for (const c of cells) {
    if (out.some((o) => distanceKm(o.lon, o.lat, c.lon, c.lat) < minSepKm)) continue;
    out.push({ rank: out.length + 1, ...c });
    if (out.length >= n) break;
  }
  return out;
}

/** 最新データまでに12か月そろっている年の一覧（新しい順） */
export function completeYears(first: Date, last: Date): number[] {
  const y0 = first.getUTCMonth() === 0 ? first.getUTCFullYear() : first.getUTCFullYear() + 1;
  const y1 = last.getUTCMonth() === 11 ? last.getUTCFullYear() : last.getUTCFullYear() - 1;
  const out: number[] = [];
  for (let y = y1; y >= y0; y--) out.push(y);
  return out;
}
