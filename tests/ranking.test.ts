import { describe, expect, it } from "vitest";
import { aggregateMonths, completeYears, daysInMonth, distanceKm, RANKINGS, topRegions, transformValue } from "../src/core/ranking";
import { getDataset } from "../src/core/datasetRegistry";
import type { Grid } from "../src/core/discoveries";

const G = (w: number, h: number, f: (i: number, j: number) => number): Grid => {
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[i + j * w] = f(i, j);
  return { width: w, height: h, data, bbox: [-180, -90, 180, 90] };
};

describe("集計", () => {
  it("月の日数とうるう年", () => {
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2025, 1)).toBe(28);
    expect(daysInMonth(2025, 11)).toBe(31);
  });
  it("降水強度 → 月降水量、K → ℃", () => {
    expect(transformValue(1, "precip-month-total", 2025, 0)).toBe(24 * 31);
    expect(transformValue(273.15, "kelvin-to-celsius", 2025, 0)).toBeCloseTo(0);
    expect(transformValue(NaN, undefined, 2025, 0)).toBeNaN();
  });
  it("平均・合計・差（欠けた月が多い場所は欠損）", () => {
    const months = [1, 2, 3, NaN].map((v) => G(1, 1, () => v));
    expect(aggregateMonths(months, "mean", 3).data[0]).toBeCloseTo(2);
    // 合計は欠けた月を平均で補って4か月分に換算
    expect(aggregateMonths(months, "sum", 3).data[0]).toBeCloseTo(8);
    expect(aggregateMonths(months, "range", 3).data[0]).toBeCloseTo(2);
    expect(aggregateMonths(months, "mean", 4).data[0]).toBeNaN();
  });
  it("大円距離", () => {
    expect(distanceKm(0, 0, 0, 1)).toBeCloseTo(111.2, 0);
    expect(distanceKm(179.5, 0, -179.5, 0)).toBeCloseTo(111.2, 0);
  });
  it("離れた地域を上位から選ぶ", () => {
    // 2つの山（経度 -90 付近と +90 付近）
    const g = G(36, 18, (i, j) => (j >= 8 && j <= 10 ? (i >= 8 && i <= 10 ? 10 : i >= 26 && i <= 28 ? 8 : 1) : 1));
    const top = topRegions(g, 3, [-90, 90], 3000);
    expect(top[0].value).toBe(10);
    expect(top[1].value).toBe(8);
    expect(top[0].lon).toBeLessThan(0);
    expect(top[1].lon).toBeGreaterThan(0);
    expect(top.map((t) => t.rank)).toEqual([1, 2, 3]);
  });
  it("12か月そろった年", () => {
    const d = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
    expect(completeYears(d(2024, 0), d(2026, 9))).toEqual([2025, 2024]);
    expect(completeYears(d(2000, 2), d(2002, 11))).toEqual([2002, 2001]);
  });
});

describe("rankings.json", () => {
  it("要件 §3.5 のランキング例をすべて含み、データセットが存在する", () => {
    expect(RANKINGS.length).toBe(7);
    for (const r of RANKINGS) expect(getDataset(r.dataset), r.id).toBeDefined();
    expect(new Set(RANKINGS.map((r) => r.id)).size).toBe(RANKINGS.length);
  });
});

describe("区画のデータの割合", () => {
  it("周囲にデータが少ない区画（内陸の川・湖など）を除ける", () => {
    // 右側は一面の海（20）、左側は陸の中の1区画だけの水面（30）
    const g = G(36, 18, (i, j) => (i >= 20 ? 20 : i === 5 && j === 9 ? 30 : NaN));
    expect(topRegions(g, 1, [-90, 90])[0].value).toBeGreaterThanOrEqual(20);
    const strict = topRegions(g, 1, [-90, 90], 1500, 1);
    expect(strict[0].value).toBe(20);
    expect(strict[0].lon).toBeGreaterThan(0);
  });
});
