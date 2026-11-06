/** 地球探偵クイズの判定（データ取得とは分離した純粋な関数） */
import { isValid } from "./stats";

export type DateSpec = string; // "YYYY" / "YYYY-MM" / "YYYY-MM-DD" / "latest"
export type Bbox = [number, number, number, number];

export type MissionCheck =
  | { type: "find-point"; dataset: string; date: DateSpec; topPercent: number; latRange?: [number, number] }
  | {
      type: "extreme-date";
      dataset: string;
      region: Bbox;
      candidates: { label: string; date: DateSpec }[];
      mode: "max" | "min";
      tolerance: number;
    }
  | {
      type: "compare-places";
      dataset: string;
      date: DateSpec;
      places: { name: string; lon: number; lat: number }[];
      mode: "max" | "min";
      tolerance: number;
    }
  | {
      type: "trend";
      dataset: string;
      region: Bbox;
      datesA: DateSpec[];
      datesB: DateSpec[];
      epsilon: number;
      labels: { up: string; down: string; same: string };
    }
  | {
      type: "correlation";
      a: string;
      b: string;
      point: [number, number];
      start: string;
      end: string;
      threshold: number;
      labels: { positive: string; negative: string; none: string };
    };

export interface Mission {
  id: string;
  title: string;
  icon: string;
  difficulty: 1 | 2 | 3;
  summary: string;
  question: string;
  howTo: string;
  map: { layers: string[]; date: DateSpec; center: [number, number]; zoom: number; marker?: [number, number] };
  check: MissionCheck;
  datesToShow?: { label: string; date: DateSpec }[];
  hints: string[];
  explanation: { simple: string; detail: string };
  caution: string;
}

export const DIFFICULTY_LABELS: Record<1 | 2 | 3, string> = { 1: "かんたん", 2: "ふつう", 3: "むずかしい" };

/** 上位 topPercent% に入るためのしきい値（欠損は除く） */
export function topThreshold(values: ArrayLike<number>, topPercent: number): number | null {
  const v: number[] = [];
  for (let k = 0; k < values.length; k++) if (isValid(values[k])) v.push(values[k]);
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  const idx = Math.min(v.length - 1, Math.max(0, Math.floor(v.length * (1 - topPercent / 100))));
  return v[idx];
}

/** 値が上位何%か（0〜100。小さいほど上位）。欠損なら null */
export function topPercentOf(values: ArrayLike<number>, x: number): number | null {
  if (!isValid(x)) return null;
  let n = 0;
  let above = 0;
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if (!isValid(v)) continue;
    n++;
    if (v > x) above++;
  }
  return n ? (above / n) * 100 : null;
}

/** 最大（最小）の選択肢と、許容差内でそれと同等の選択肢をすべて正解とする */
export function acceptedExtremes(items: { label: string; value: number | null }[], mode: "max" | "min", tolerance: number): string[] {
  const valid = items.filter((x): x is { label: string; value: number } => isValid(x.value));
  if (!valid.length) return [];
  const best = mode === "max" ? Math.max(...valid.map((x) => x.value)) : Math.min(...valid.map((x) => x.value));
  return valid.filter((x) => Math.abs(x.value - best) <= tolerance).map((x) => x.label);
}

export type Trend = "up" | "down" | "same";

export function trendOf(a: number, b: number, epsilon: number): Trend {
  const d = b - a;
  if (Math.abs(d) < epsilon) return "same";
  return d > 0 ? "up" : "down";
}

export type CorrelationKind = "positive" | "negative" | "none";

export function correlationKind(r: number, threshold: number): CorrelationKind {
  if (r >= threshold) return "positive";
  if (r <= -threshold) return "negative";
  return "none";
}

/** ヒント数・挑戦回数から星（1〜3） */
export function starsFor(attempts: number, hintsUsed: number, gaveUp: boolean): 0 | 1 | 2 | 3 {
  if (gaveUp) return 0;
  if (attempts <= 1 && hintsUsed === 0) return 3;
  if (attempts <= 2 && hintsUsed <= 1) return 2;
  return 1;
}
