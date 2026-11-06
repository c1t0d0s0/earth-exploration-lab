import { describe, expect, it } from "vitest";
import { ARCTIC_EXTENT, lonLatToPolarNorth, samplePolar, tilePixelToLonLat } from "../src/core/polar";

describe("polar stereographic (EPSG:3995)", () => {
  it("北極点は原点", () => {
    const [x, y] = lonLatToPolarNorth(0, 90);
    expect(Math.abs(x)).toBeLessThan(1e-6);
    expect(Math.abs(y)).toBeLessThan(1e-6);
  });
  it("経度0°は -y 方向、経度90°E は +x 方向", () => {
    const [x0, y0] = lonLatToPolarNorth(0, 80);
    expect(Math.abs(x0)).toBeLessThan(1e-6);
    expect(y0).toBeLessThan(0);
    const [x90, y90] = lonLatToPolarNorth(90, 80);
    expect(x90).toBeGreaterThan(0);
    expect(Math.abs(y90)).toBeLessThan(1e-6);
  });
  it("経度45°では |x| = |y|（対称性）", () => {
    const [x, y] = lonLatToPolarNorth(45, 75);
    expect(Math.abs(x)).toBeCloseTo(Math.abs(y), 6);
    expect(x).toBeGreaterThan(0);
  });
  it("正角図法で、標準緯線 71°N の縮尺がちょうど 1 になる（数値微分で検証）", () => {
    const a = 6378137;
    const e2 = 0.0818191908426215 ** 2;
    const rho = (lat: number) => -lonLatToPolarNorth(0, lat)[1];
    const scales = (latDeg: number) => {
      const phi = (latDeg * Math.PI) / 180;
      const h = 1e-6;
      // 経線方向: dρ/dφ を子午線曲率半径 M で割る
      const dRho = Math.abs(rho(latDeg + (h * 180) / Math.PI) - rho(latDeg - (h * 180) / Math.PI)) / (2 * h);
      const M = (a * (1 - e2)) / Math.pow(1 - e2 * Math.sin(phi) ** 2, 1.5);
      // 緯線方向: ρ を 緯線の半径 a·m で割る
      const m = Math.cos(phi) / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
      return { k: dRho / M, h: rho(latDeg) / (a * m) };
    };
    const s71 = scales(71);
    expect(s71.k).toBeCloseTo(1, 6);
    expect(s71.h).toBeCloseTo(1, 9);
    // 正角：どの緯度でも経線方向と緯線方向の縮尺が等しい
    for (const lat of [60, 75, 85]) {
      const s = scales(lat);
      expect(s.k).toBeCloseTo(s.h, 6);
    }
  });
  it("格子から最近傍の値を取り出す", () => {
    const grid = { width: 2, height: 2, data: [1, 2, 3, 4], extent: ARCTIC_EXTENT };
    // 経度0°・北緯80°は 中心より下(y<0)で x≈0 → 右下か左下
    expect([3, 4]).toContain(samplePolar(grid, 0, 80));
    // 経度180°（y>0）→ 上の行
    expect([1, 2]).toContain(samplePolar(grid, 180, 80));
    expect(samplePolar(grid, 0, -10)).toBeNaN();
  });
  it("タイルのピクセル → 経度緯度", () => {
    const [lon, lat] = tilePixelToLonLat(0, 0, 0, 127.5, 127.5, 256);
    expect(lon).toBeCloseTo(0, 6);
    expect(lat).toBeCloseTo(0, 6);
  });
});
