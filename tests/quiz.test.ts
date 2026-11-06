import { describe, expect, it } from "vitest";
import quiz from "../src/data/quiz.json";
import { acceptedExtremes, correlationKind, starsFor, topPercentOf, topThreshold, trendOf, type Mission } from "../src/core/quiz";
import { loadProgress, resetProgress, saveProgress } from "../src/core/progress";
import { getDataset } from "../src/core/datasetRegistry";
import { parseDateKey } from "../src/core/dates";
import { lonLatToPixel, neighborhoodMean, smoothGrid, valueAt, type Grid } from "../src/core/discoveries";

describe("判定関数", () => {
  it("上位 n% のしきい値と順位", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(topThreshold(v, 5)).toBe(96);
    expect(topPercentOf(v, 96)).toBe(4);
    expect(topPercentOf(v, 100)).toBe(0);
    expect(topPercentOf(v, NaN)).toBeNull();
    expect(topThreshold([NaN], 5)).toBeNull();
  });
  it("最大値と許容差内の選択肢を正解にする", () => {
    const items = [
      { label: "2月", value: 16 },
      { label: "8月", value: 28.1 },
      { label: "11月", value: 27.9 },
      { label: "5月", value: null },
    ];
    expect(acceptedExtremes(items, "max", 0.3)).toEqual(["8月", "11月"]);
    expect(acceptedExtremes(items, "max", 0.1)).toEqual(["8月"]);
    expect(acceptedExtremes(items, "min", 0.1)).toEqual(["2月"]);
  });
  it("増減と相関の分類", () => {
    expect(trendOf(0.3, 0.32, 0.01)).toBe("up");
    expect(trendOf(0.3, 0.295, 0.01)).toBe("same");
    expect(trendOf(0.3, 0.2, 0.01)).toBe("down");
    expect(correlationKind(0.5, 0.3)).toBe("positive");
    expect(correlationKind(-0.5, 0.3)).toBe("negative");
    expect(correlationKind(0.1, 0.3)).toBe("none");
  });
  it("星の数", () => {
    expect(starsFor(1, 0, false)).toBe(3);
    expect(starsFor(2, 1, false)).toBe(2);
    expect(starsFor(4, 3, false)).toBe(1);
    expect(starsFor(1, 0, true)).toBe(0);
  });
});

describe("格子ヘルパー", () => {
  const g: Grid = { width: 4, height: 2, bbox: [-180, -90, 180, 90], data: [1, 2, 3, 4, 5, 6, 7, NaN] };
  it("経度緯度 → ピクセル", () => {
    expect(lonLatToPixel(g, -170, 80)).toEqual([0, 0]);
    expect(lonLatToPixel(g, 170, -10)).toEqual([3, 1]);
    expect(lonLatToPixel(g, 190, 80)).toEqual([0, 0]); // 経度の折り返し
    expect(valueAt(g, -100, -45)).toBe(5);
    expect(valueAt(g, -80, -45)).toBe(6);
  });
  it("周囲平均と平滑化（中心が欠損なら欠損のまま）", () => {
    expect(neighborhoodMean(g, 1, 0, 1)).toBeCloseTo((1 + 2 + 3 + 5 + 6 + 7) / 6);
    const s = smoothGrid(g, 1);
    expect(s.data[7]).toBeNaN();
  });
});

describe("クリア履歴", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  it("保存・読み込み・リセット", () => {
    const st = mem();
    saveProgress("a", { cleared: true, stars: 2, attempts: 2, hintsUsed: 1 }, st);
    expect(loadProgress(st).a.stars).toBe(2);
    // 星の少ない再挑戦では上書きしない
    saveProgress("a", { cleared: true, stars: 1, attempts: 5, hintsUsed: 2 }, st);
    expect(loadProgress(st).a.stars).toBe(2);
    saveProgress("a", { cleared: true, stars: 3, attempts: 1, hintsUsed: 0 }, st);
    expect(loadProgress(st).a.stars).toBe(3);
    resetProgress(st);
    expect(loadProgress(st)).toEqual({});
  });
  it("壊れたデータでも落ちない", () => {
    expect(loadProgress({ getItem: () => "{broken" })).toEqual({});
  });
});

describe("quiz.json", () => {
  const missions = (quiz as unknown as { missions: Mission[] }).missions;
  it("要件 §3.4 のミッション例を含み、ID が重複しない", () => {
    expect(new Set(missions.map((m) => m.id)).size).toBe(missions.length);
    for (const t of ["世界で最も雨が多い地域を探せ", "砂漠は広がっているのか", "海水温が高いのはいつ？", "都市はなぜ暑いのか", "北極の氷を追跡せよ", "雨が降ると植物は増える？"]) {
      expect(missions.some((m) => m.title === t), t).toBe(true);
    }
  });
  it("参照するデータセット・日付が正しい", () => {
    const d = (s: string) => s === "latest" || !Number.isNaN(parseDateKey(s).getTime());
    for (const m of missions) {
      for (const l of m.map.layers) expect(getDataset(l), `${m.id} ${l}`).toBeDefined();
      expect(d(m.map.date)).toBe(true);
      const c = m.check;
      const keys = c.type === "correlation" ? [c.a, c.b] : [c.dataset];
      for (const k of keys) expect(getDataset(k), `${m.id} ${k}`).toBeDefined();
      if (c.type === "extreme-date") c.candidates.forEach((x) => expect(d(x.date)).toBe(true));
      if (c.type === "trend") [...c.datesA, ...c.datesB].forEach((x) => expect(d(x)).toBe(true));
      expect(m.hints.length).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(m.difficulty);
    }
  });
});
