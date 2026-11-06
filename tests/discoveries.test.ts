import { describe, expect, it } from "vitest";
import { changeWord, extentChange, findPeak, pairedAreaMeanDiff, pixelLonLat, sumGrids, type Grid } from "../src/core/discoveries";
import { placeLabel, regionName } from "../src/core/regions";

const G = (w: number, h: number, f: (i: number, j: number) => number): Grid => {
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[i + j * w] = f(i, j);
  return { width: w, height: h, data, bbox: [-180, -90, 180, 90] };
};

describe("pixelLonLat", () => {
  it("1°格子のピクセル中心", () => {
    const g = G(360, 180, () => 0);
    expect(pixelLonLat(g, 0, 0)).toEqual([-179.5, 89.5]);
    expect(pixelLonLat(g, 359, 179)).toEqual([179.5, -89.5]);
  });
});

describe("sumGrids", () => {
  it("欠損を除いて足し、すべて欠損なら NaN のまま", () => {
    const a = G(2, 1, (i) => (i === 0 ? 1 : NaN));
    const b = G(2, 1, (i) => (i === 0 ? 2 : NaN));
    const s = sumGrids([a, b], 24);
    expect(s.data[0]).toBe(72);
    expect(s.data[1]).toBeNaN();
  });
});

describe("findPeak", () => {
  it("周囲の平均が最大の地点を返す", () => {
    const g = G(36, 18, (i, j) => (i >= 20 && i <= 22 && j >= 8 && j <= 10 ? 10 : 1));
    const p = findPeak(g)!;
    const [lon, lat] = pixelLonLat(g, 21, 9);
    expect(p.lon).toBe(lon);
    expect(p.lat).toBe(lat);
    expect(p.value).toBe(10);
  });
  it("1点だけ突出した値（周囲が欠損）は採用しない", () => {
    const g = G(36, 18, (i, j) => (i === 5 && j === 5 ? 100 : i < 30 ? NaN : 2));
    const p = findPeak(g)!;
    expect(p.value).toBe(2);
  });
  it("緯度の範囲で絞り込める", () => {
    const g = G(36, 18, (_i, j) => 18 - j); // 北ほど大きい
    const p = findPeak(g, 1, [-30, 30])!;
    expect(p.lat).toBeLessThanOrEqual(30);
    expect(p.lat).toBeGreaterThan(20);
  });
  it("日付変更線をまたいで周囲を見る", () => {
    const g = G(36, 18, (i, j) => ((i === 0 || i === 35) && j >= 8 && j <= 10 ? 9 : 0));
    const p = findPeak(g)!;
    expect(Math.abs(p.lon)).toBeGreaterThan(170);
  });
});

describe("pairedAreaMeanDiff", () => {
  it("両方に値がある場所だけで比べる", () => {
    const a = G(4, 2, (i) => (i === 3 ? NaN : 10));
    const b = G(4, 2, (i) => (i === 0 ? NaN : 11));
    const d = pairedAreaMeanDiff(a, b)!;
    expect(d.diff).toBeCloseTo(1);
    expect(d.coverage).toBeCloseTo(0.5);
  });
  it("面積の重み：低緯度のほうが重く数えられる", () => {
    // 北半球の高緯度だけ +10、それ以外は変化なし → 単純平均より差は小さくなる
    const a = G(1, 18, () => 0);
    const b = G(1, 18, (_i, j) => (j < 3 ? 10 : 0));
    const d = pairedAreaMeanDiff(a, b)!;
    expect(d.diff).toBeGreaterThan(0);
    expect(d.diff).toBeLessThan((10 * 3) / 18);
  });
  it("比べられる場所がなければ null", () => {
    expect(pairedAreaMeanDiff(G(2, 2, () => NaN), G(2, 2, () => 1))).toBeNull();
  });
});

describe("extentChange", () => {
  it("しきい値以上の数の比", () => {
    const r = extentChange([20, 20, 50, 0, NaN], [20, 10, 50, 0, 90], 15)!;
    expect(r.countA).toBe(3);
    expect(r.countB).toBe(2);
    expect(r.ratio).toBeCloseTo(2 / 3);
  });
});

describe("changeWord", () => {
  it("小さな差はほぼ同じ", () => {
    expect(changeWord(0.01, 0.05)).toBe("ほぼ同じ");
    expect(changeWord(0.3, 0.05)).toBe("高い");
    expect(changeWord(-0.3, 0.05, "増えた", "減った")).toBe("減った");
  });
});

describe("regionName", () => {
  it("代表的な場所", () => {
    expect(regionName(10, 25)).toBe("サハラ砂漠");
    expect(regionName(139.7, 35.7)).toBe("本州付近");
    expect(regionName(-60, -3)).toBe("アマゾン川流域");
    expect(regionName(90, 15)).toBe("ベンガル湾");
    expect(regionName(-150, 8)).toBe("赤道付近の太平洋（熱帯収束帯）");
    expect(regionName(0, 85)).toBe("北極海");
    // 陸と海をまちがえやすい場所
    expect(regionName(-47, -26)).toBe("ブラジル南東部（大西洋岸の森林）");
    expect(regionName(154, -15)).toBe("サンゴ海");
    expect(regionName(125, -11)).toBe("ティモール海");
    expect(regionName(149, -21)).not.toBe("サンゴ海"); // クイーンズランドの陸
    expect(regionName(153, -4)).toBe("ビスマルク諸島・ソロモン諸島付近");
  });
  it("経度 180 を超える値も扱える", () => {
    expect(regionName(370, 25)).toBe("サハラ砂漠");
  });
  it("地域名に緯度経度を添える", () => {
    expect(placeLabel(10.4, 25.6)).toBe("サハラ砂漠（北緯26°・東経10°）");
  });
});
