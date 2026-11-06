import { describe, expect, it } from "vitest";
import {
  destination,
  distanceToSegmentKm,
  findPasses,
  gcDistanceKm,
  groundTrack,
  localSolarTime,
  makeOrbit,
  nodalPrecession,
  periodMinutes,
  solarElevationDeg,
  subSatellitePoint,
  sunSyncInclinationDeg,
} from "../src/core/orbit";
import sats from "../src/data/satellites.json";

describe("軌道の物理", () => {
  it("周期：高度400km 約92分、800km 約101分（ケプラーの第3法則）", () => {
    expect(periodMinutes(407)).toBeGreaterThan(92);
    expect(periodMinutes(407)).toBeLessThan(93);
    expect(periodMinutes(800)).toBeGreaterThan(100.5);
    expect(periodMinutes(800)).toBeLessThan(101.2);
  });
  it("太陽同期軌道の傾斜角は 97〜99°（高いほど大きい）", () => {
    const i628 = sunSyncInclinationDeg(628);
    const i800 = sunSyncInclinationDeg(800);
    expect(i628).toBeGreaterThan(97.5);
    expect(i628).toBeLessThan(98.2);
    expect(i800).toBeGreaterThan(98.4);
    expect(i800).toBeLessThan(98.8);
    expect(i800).toBeGreaterThan(i628);
  });
  it("太陽同期軌道では軌道面が1日に約0.9856°東へ回る", () => {
    const rate = (nodalPrecession(800, (sunSyncInclinationDeg(800) * Math.PI) / 180) * 86400 * 180) / Math.PI;
    expect(rate).toBeCloseTo(360 / 365.2422, 4);
  });
  it("傾斜角65°の軌道では、軌道面は西へ回る（太陽非同期）", () => {
    expect(nodalPrecession(407, (65 * Math.PI) / 180)).toBeLessThan(0);
  });
});

describe("地上軌跡", () => {
  const t0 = Date.UTC(2026, 10, 6, 0, 0, 0);
  it("最大緯度は軌道傾斜角（順行）または 180°−傾斜角（逆行）", () => {
    const gpm = makeOrbit({ altKm: 407, inclDeg: 65, t0 });
    const track = groundTrack(gpm, t0, t0 + 2 * 3600e3, 10);
    expect(Math.max(...track.map((p) => p.lat))).toBeCloseTo(65, 0);
    const gc = makeOrbit({ altKm: 800, localTimeDescending: 10.5, t0 });
    const tr2 = groundTrack(gc, t0, t0 + 2 * 3600e3, 10);
    expect(Math.max(...tr2.map((p) => p.lat))).toBeCloseTo(180 - gc.inclDeg, 0);
  });
  it("開始時刻には昇交点（赤道）にいる", () => {
    const o = makeOrbit({ altKm: 700, localTimeDescending: 1.5, t0 });
    expect(subSatellitePoint(o, t0)[1]).toBeCloseTo(0, 6);
  });
  it("太陽同期軌道：降交点（南向きに赤道を通る点）の地方時が仕様どおり（何周しても）", () => {
    for (const [alt, ltdn] of [[800, 10.5], [700, 1.5], [628, 12]] as const) {
      const o = makeOrbit({ altKm: alt, localTimeDescending: ltdn, t0 });
      const tr = groundTrack(o, t0, t0 + 86400e3, 5);
      const crossings: number[] = [];
      for (let k = 1; k < tr.length; k++) if (tr[k - 1].lat > 0 && tr[k].lat <= 0) crossings.push(localSolarTime(tr[k].lon, tr[k].t));
      expect(crossings.length).toBeGreaterThan(12);
      for (const lt of crossings) {
        const diff = Math.abs(((lt - ltdn + 36) % 24) - 12);
        expect(diff, `alt ${alt}: ${lt}`).toBeLessThan(0.05);
      }
    }
  });
});

describe("距離と観測範囲", () => {
  it("大円距離と移動", () => {
    expect(gcDistanceKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
    const [lon, lat] = destination(0, 0, 90, 111.19);
    expect(lon).toBeCloseTo(1, 2);
    expect(lat).toBeCloseTo(0, 6);
  });
  it("線分からの距離（真横・端の外側）", () => {
    expect(distanceToSegmentKm([0, 0], [2, 0], [1, 1])).toBeCloseTo(111.19, 0);
    expect(distanceToSegmentKm([0, 0], [2, 0], [3, 0])).toBeCloseTo(111.19, 0);
  });
  it("観測幅の中を通った回だけ数える", () => {
    const track = [-3, -2, -1, 0, 1, 2, 3].map((lat, k) => ({ t: k * 1000, lon: 0, lat }));
    expect(findPasses(track, [0.5, 0], 100)).toHaveLength(1);
    expect(findPasses(track, [2, 0], 100)).toHaveLength(0);
  });
  it("太陽高度：春分ごろの赤道の正午はほぼ真上、真夜中は地平線の下", () => {
    const noon = Date.UTC(2026, 2, 20, 12, 0);
    expect(solarElevationDeg(0, 0, noon)).toBeGreaterThan(85);
    expect(solarElevationDeg(180, 0, noon)).toBeLessThan(-80);
  });
});

describe("satellites.json", () => {
  it("観測幅・高度・出典がある", () => {
    for (const s of sats.satellites) {
      expect(s.altitudeKm).toBeGreaterThan(300);
      expect(s.sensors.length).toBeGreaterThan(0);
      for (const x of s.sensors) {
        expect(x.swathKm).toBeGreaterThan(0);
        expect(Object.keys(sats.sensorKinds)).toContain(x.kind);
      }
      expect(s.sources.length).toBeGreaterThan(0);
    }
  });
});
