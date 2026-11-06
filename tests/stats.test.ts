import { describe, expect, it } from "vitest";
import { alignByKey, describeCorrelation, formatNumber, mean, pearson, sampleEvenly } from "../src/core/stats";

describe("mean", () => {
  it("欠損 (null/NaN) を除いて平均する", () => {
    expect(mean([1, 2, null, NaN, 3])).toBe(2);
  });
  it("有効値がなければ null", () => {
    expect(mean([null, NaN])).toBeNull();
  });
});

describe("pearson", () => {
  it("完全な正の相関は r=1、回帰直線も求まる", () => {
    const c = pearson([1, 2, 3, 4], [2, 4, 6, 8])!;
    expect(c.r).toBeCloseTo(1);
    expect(c.slope).toBeCloseTo(2);
    expect(c.intercept).toBeCloseTo(0);
    expect(c.n).toBe(4);
  });
  it("完全な負の相関は r=-1", () => {
    expect(pearson([1, 2, 3], [3, 2, 1])!.r).toBeCloseTo(-1);
  });
  it("欠損を含む組は除外する", () => {
    const c = pearson([1, 2, null, 3, 4], [1, 2, 100, NaN, 4])!;
    expect(c.n).toBe(3);
    expect(c.r).toBeCloseTo(1);
  });
  it("有効な組が3未満、または分散0なら null", () => {
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  it("既知の値と一致する", () => {
    // x=[1,2,3,4,5], y=[2,1,4,3,5] → r = 0.8
    expect(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])!.r).toBeCloseTo(0.8);
  });
});

describe("describeCorrelation", () => {
  it("強さと向きを言葉にする", () => {
    expect(describeCorrelation(0.85).label).toBe("強い正の相関");
    expect(describeCorrelation(-0.5).label).toBe("中程度の負の相関");
    expect(describeCorrelation(0.25).label).toBe("弱い正の相関");
    expect(describeCorrelation(0.05).label).toBe("ほとんど相関なし");
  });
});

describe("alignByKey", () => {
  it("共通するキーだけを a の順でそろえる", () => {
    const a = [{ key: "2024-01", value: 1 }, { key: "2024-02", value: 2 }, { key: "2024-03", value: 3 }];
    const b = [{ key: "2024-03", value: 30 }, { key: "2024-01", value: 10 }];
    expect(alignByKey(a, b)).toEqual({ keys: ["2024-01", "2024-03"], xs: [1, 3], ys: [10, 30] });
  });
});

describe("sampleEvenly", () => {
  it("上限以下ならそのまま", () => {
    expect(sampleEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });
  it("先頭と末尾を含めて等間隔に間引く", () => {
    const r = sampleEvenly(Array.from({ length: 100 }, (_, i) => i), 5);
    expect(r).toEqual([0, 25, 50, 74, 99]);
  });
});

describe("formatNumber", () => {
  it("欠損は —", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(NaN)).toBe("—");
  });
  it("大きさに応じた桁数", () => {
    expect(formatNumber(1234.5)).toBe("1,235");
    expect(formatNumber(12.345)).toBe("12.3");
    expect(formatNumber(0.12345)).toBe("0.123");
  });
});
