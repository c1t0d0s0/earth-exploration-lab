/** 地球探偵クイズ：実際の衛星データから正解を決める */
import raw from "../data/quiz.json";
import { getDataset } from "./datasetRegistry";
import { formatDateJa, parseDateKey } from "./dates";
import { findPeak, pixelLonLat, lonLatToPixel, smoothGrid, type Grid, type Peak } from "./discoveries";
import { getAvailableRange, getGlobalGrid, getRegionSummary, toDisplay } from "./jaxaClient";
import { acceptedExtremes, correlationKind, topPercentOf, topThreshold, trendOf, type DateSpec, type Mission } from "./quiz";
import { placeLabel } from "./regions";
import { alignByKey, formatNumber, pearson } from "./stats";
import { fetchPointSeries } from "./timeSeries";
import type { DatasetDef } from "./types";

export const MISSIONS: Mission[] = (raw as unknown as { missions: Mission[] }).missions;

export function getMission(id: string | null): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}

function dataset(key: string): DatasetDef {
  const d = getDataset(key);
  if (!d) throw new Error(`dataset ${key} がありません`);
  return d;
}

export async function resolveDate(ds: DatasetDef, spec: DateSpec): Promise<Date> {
  if (spec === "latest") return (await getAvailableRange(ds)).last;
  return parseDateKey(spec);
}

const fmtVal = (ds: DatasetDef, v: number | null) => (v == null ? "データなし" : `${formatNumber(toDisplay(ds, v))} ${ds.unitLabel}`);

export interface FindPointEvaluation {
  kind: "find-point";
  ds: DatasetDef;
  date: Date;
  /** 周囲平均にした格子（判定に使う） */
  grid: Grid;
  threshold: number;
  topPercent: number;
  peak: Peak;
  latRange: [number, number];
}

export interface ChoiceEvaluation {
  kind: "choice";
  options: { key: string; label: string }[];
  accepted: string[];
  /** 判定に使ったデータ（答えたあとに表示） */
  facts: string[];
}

export type Evaluation = FindPointEvaluation | ChoiceEvaluation;

/** ミッションの正解をデータから求める */
export async function evaluateMission(m: Mission, onProgress?: (msg: string) => void): Promise<Evaluation> {
  const c = m.check;
  switch (c.type) {
    case "find-point": {
      const ds = dataset(c.dataset);
      const date = await resolveDate(ds, c.date);
      onProgress?.("世界のデータを集めています…");
      const g = await getGlobalGrid(ds, date);
      const latRange = c.latRange ?? [-90, 90];
      // 約300km四方の平均で判定（1ピクセルだけの極端な値に左右されないように）
      const sm = smoothGrid(g, 1);
      const inRange = new Float32Array(sm.data.length).fill(NaN);
      for (let j = 0; j < sm.height; j++) {
        const lat = pixelLonLat(sm, 0, j)[1];
        if (lat < latRange[0] || lat > latRange[1]) continue;
        for (let i = 0; i < sm.width; i++) inRange[i + j * sm.width] = sm.data[i + j * sm.width];
      }
      const grid = { ...sm, data: inRange };
      const threshold = topThreshold(inRange, c.topPercent);
      const peak = findPeak(g, 1, latRange);
      if (threshold == null || !peak) throw new Error("データが足りません");
      return { kind: "find-point", ds, date: g.date, grid, threshold, topPercent: c.topPercent, peak, latRange };
    }
    case "extreme-date": {
      const ds = dataset(c.dataset);
      onProgress?.("それぞれの時期のデータを調べています…");
      const items = await Promise.all(
        c.candidates.map(async (x) => {
          const s = await getRegionSummary(ds, await resolveDate(ds, x.date), c.region, 32);
          return { label: x.label, value: s.mean };
        }),
      );
      return {
        kind: "choice",
        options: c.candidates.map((x) => ({ key: x.label, label: x.label })),
        accepted: acceptedExtremes(items, c.mode, c.tolerance),
        facts: items.map((x) => `${x.label}：${fmtVal(ds, x.value)}`),
      };
    }
    case "compare-places": {
      const ds = dataset(c.dataset);
      const date = await resolveDate(ds, c.date);
      onProgress?.("それぞれの場所のデータを調べています…");
      const items = await Promise.all(
        c.places.map(async (p) => {
          const e = 0.05;
          const s = await getRegionSummary(ds, date, [p.lon - e, p.lat - e, p.lon + e, p.lat + e], 10);
          return { label: p.name, value: s.mean };
        }),
      );
      return {
        kind: "choice",
        options: c.places.map((p) => ({ key: p.name, label: p.name })),
        accepted: acceptedExtremes(items, c.mode, c.tolerance),
        facts: items.map((x) => `${x.label}：${fmtVal(ds, x.value)}（${formatDateJa(date, ds.temporal)}）`),
      };
    }
    case "trend": {
      const ds = dataset(c.dataset);
      onProgress?.("2つの時期のデータを集めています…");
      const avg = async (dates: DateSpec[]) => {
        const ms = await Promise.all(dates.map(async (d) => (await getRegionSummary(ds, await resolveDate(ds, d), c.region, 64)).mean));
        const v = ms.filter((x): x is number => x != null);
        return { mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, each: ms };
      };
      const [a, b] = await Promise.all([avg(c.datesA), avg(c.datesB)]);
      if (a.mean == null || b.mean == null) throw new Error("データが足りません");
      const t = trendOf(a.mean, b.mean, c.epsilon);
      const span = (ds2: DateSpec[]) => `${ds2[0].slice(0, 4)}〜${ds2[ds2.length - 1].slice(0, 4)}年`;
      return {
        kind: "choice",
        options: (["up", "down", "same"] as const).map((k) => ({ key: k, label: c.labels[k] })),
        accepted: [t],
        facts: [
          `${span(c.datesA)}の平均：${fmtVal(ds, a.mean)}（${c.datesA.map((d, i) => `${d.slice(0, 4)}年 ${fmtVal(ds, a.each[i])}`).join("、")}）`,
          `${span(c.datesB)}の平均：${fmtVal(ds, b.mean)}（${c.datesB.map((d, i) => `${d.slice(0, 4)}年 ${fmtVal(ds, b.each[i])}`).join("、")}）`,
          `変化：${b.mean - a.mean >= 0 ? "+" : "−"}${formatNumber(Math.abs(b.mean - a.mean), 3)}（±${c.epsilon} 未満は「ほとんど変わらない」としています）`,
        ],
      };
    }
    case "correlation": {
      const da = dataset(c.a);
      const db = dataset(c.b);
      const [lon, lat] = c.point;
      const start = parseDateKey(c.start);
      const end = parseDateKey(c.end);
      let done = 0;
      const prog = () => onProgress?.(`毎月のデータを集めています… ${++done}`);
      const [sa, sb] = await Promise.all([
        fetchPointSeries(da, lon, lat, start, end, { onProgress: prog }),
        fetchPointSeries(db, lon, lat, start, end, { onProgress: prog }),
      ]);
      const toK = (s: typeof sa, ds: DatasetDef) => s.map((p) => ({ key: p.key.slice(0, 7), value: toDisplay(ds, p.value) }));
      const { xs, ys } = alignByKey(toK(sa, da), toK(sb, db));
      const r = pearson(xs, ys);
      if (!r) throw new Error("相関を計算できるデータが足りません");
      // 植物は雨のあとに育つので、1か月ずらした相関も参考に出す
      const ka = toK(sa, da);
      const kb = toK(sb, db);
      const shifted = ka.slice(0, -1).map((p, i) => ({ key: kb[i + 1]?.key ?? "", value: p.value }));
      const lag = alignByKey(shifted, kb);
      const r1 = pearson(lag.xs, lag.ys);
      const kind = correlationKind(r.r, c.threshold);
      return {
        kind: "choice",
        options: (["positive", "negative", "none"] as const).map((k) => ({ key: k, label: c.labels[k] })),
        accepted: [kind],
        facts: [
          `${placeLabel(lon, lat)}、${c.start}〜${c.end}の${r.n}か月分`,
          `相関係数 r = ${r.r.toFixed(2)}（${c.threshold} 以上を「正の相関」、−${c.threshold} 以下を「負の相関」としています）`,
          r1 ? `参考：${db.shortName}を1か月あとにずらしてくらべると r = ${r1.r.toFixed(2)}` : "",
        ].filter(Boolean),
      };
    }
  }
}

export interface PointJudgement {
  correct: boolean;
  value: number | null;
  /** 上位何%か */
  topPct: number | null;
  place: string;
  outOfRange: boolean;
}

/** find-point：クリックした場所の判定 */
export function judgePoint(e: FindPointEvaluation, lon: number, lat: number): PointJudgement {
  const place = placeLabel(lon, lat);
  if (lat < e.latRange[0] || lat > e.latRange[1]) return { correct: false, value: null, topPct: null, place, outOfRange: true };
  const p = lonLatToPixel(e.grid, lon, lat);
  const v = p ? e.grid.data[p[0] + p[1] * e.grid.width] : NaN;
  const value = Number.isFinite(v) ? v : null;
  return { correct: value != null && value >= e.threshold, value, topPct: value == null ? null : topPercentOf(e.grid.data, value), place, outOfRange: false };
}
