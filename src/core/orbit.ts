/**
 * 人工衛星の軌道の簡易モデル（観測衛星シミュレーター用）。
 * - 円軌道・球形の地球（地上の位置）を仮定
 * - 周期はケプラーの第3法則、軌道面の回転（歳差）は地球の扁平（J2 項）から計算
 * - 太陽同期軌道の軌道傾斜角は「軌道面の回転が1年で1周（約0.9856°/日）」になる条件から求める
 * 実際の衛星の位置を予測するものではなく、軌道と観測範囲の「しくみ」を体験するためのモデル。
 */
export const MU = 398600.4418; // 地球の重力定数 [km^3/s^2]
export const R_EARTH = 6378.137; // 赤道半径 [km]
export const J2 = 1.08263e-3;
export const OMEGA_EARTH = 7.2921159e-5; // 地球の自転角速度 [rad/s]
const SUN_SYNC_RATE = (2 * Math.PI) / (365.2422 * 86400); // [rad/s]
const DEG = Math.PI / 180;
const R_MEAN = 6371; // 地表の距離計算用 [km]

export function meanMotion(altKm: number): number {
  const a = R_EARTH + altKm;
  return Math.sqrt(MU / a ** 3);
}

/** 周期 [分] */
export function periodMinutes(altKm: number): number {
  return (2 * Math.PI) / meanMotion(altKm) / 60;
}

/** J2 による昇交点の移動の速さ [rad/s]（東向きが正） */
export function nodalPrecession(altKm: number, inclRad: number): number {
  const a = R_EARTH + altKm;
  return -1.5 * meanMotion(altKm) * J2 * (R_EARTH / a) ** 2 * Math.cos(inclRad);
}

/** 太陽同期軌道になる軌道傾斜角 [度] */
export function sunSyncInclinationDeg(altKm: number): number {
  const a = R_EARTH + altKm;
  const c = -SUN_SYNC_RATE / (1.5 * meanMotion(altKm) * J2 * (R_EARTH / a) ** 2);
  return Math.acos(c) / DEG;
}

export interface OrbitModel {
  altKm: number;
  inclDeg: number;
  /** 開始時刻（衛星が昇交点にいる時刻） [ms] */
  t0: number;
  /** 開始時の昇交点の経度 [度] */
  nodeLon0: number;
}

const utcHours = (ms: number) => (((ms / 3600000) % 24) + 24) % 24;

/**
 * 軌道モデルを作る。太陽同期軌道は「降交点を通る地方時」が仕様どおりになるよう昇交点の経度を決める。
 * （昇交点の地方時 = 降交点の地方時 + 12時間。地方時 ≒ 世界時 + 経度/15）
 */
export function makeOrbit(opts: { altKm: number; inclDeg?: number; localTimeDescending?: number; t0: number; nodeLon0?: number }): OrbitModel {
  const inclDeg = opts.inclDeg ?? sunSyncInclinationDeg(opts.altKm);
  let nodeLon0 = opts.nodeLon0 ?? 0;
  if (opts.localTimeDescending != null) {
    // 昇交点から降交点までは半周期かかり、その間に地球が自転するので、その分も考えて決める
    const half = (Math.PI / meanMotion(opts.altKm)) * 1000;
    // 降交点の地方時 = UTC(t0+half) + (nodeLon0 + 180 + 移動量)/15 が LTDN になるように逆算
    const drift = ((nodalPrecession(opts.altKm, inclDeg * DEG) - OMEGA_EARTH) * (half / 1000)) / DEG;
    const ltdn = opts.localTimeDescending;
    nodeLon0 = (ltdn - utcHours(opts.t0 + half)) * 15 - 180 - drift;
  }
  return { altKm: opts.altKm, inclDeg, t0: opts.t0, nodeLon0: wrapLon(nodeLon0) };
}

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** 衛星の真下の地点（経度・緯度 [度]） */
export function subSatellitePoint(o: OrbitModel, t: number): [number, number] {
  const dt = (t - o.t0) / 1000;
  const n = meanMotion(o.altKm);
  const i = o.inclDeg * DEG;
  const u = n * dt;
  const lat = Math.asin(Math.sin(i) * Math.sin(u));
  const dl = Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u));
  const lon = o.nodeLon0 * DEG + dl + (nodalPrecession(o.altKm, i) - OMEGA_EARTH) * dt;
  return [wrapLon(lon / DEG), lat / DEG];
}

/** 平均太陽時による地方時 [時] */
export function localSolarTime(lon: number, t: number): number {
  return (((utcHours(t) + lon / 15) % 24) + 24) % 24;
}

/** 太陽高度 [度]（簡易式。季節による太陽の赤緯と時角から計算） */
export function solarElevationDeg(lon: number, lat: number, t: number): number {
  const d = new Date(t);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = (t - start) / 86400000;
  const decl = -23.44 * DEG * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
  const ha = (localSolarTime(lon, t) - 12) * 15 * DEG;
  const phi = lat * DEG;
  return Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha)) / DEG;
}

/** 2地点間の大円距離 [km] */
export function gcDistanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2;
  return 2 * R_MEAN * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 方位角 [度]（北=0、東=90） */
export function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.atan2(y, x) / DEG;
}

/** ある地点から方位・距離だけ進んだ地点 */
export function destination(lon: number, lat: number, bearing: number, distKm: number): [number, number] {
  const d = distKm / R_MEAN;
  const b = bearing * DEG;
  const p1 = lat * DEG;
  const l1 = lon * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [wrapLon(l2 / DEG), p2 / DEG];
}

/** 線分（大円）から地点までの最短距離 [km] */
export function distanceToSegmentKm(a: [number, number], b: [number, number], p: [number, number]): number {
  const d13 = gcDistanceKm(a[0], a[1], p[0], p[1]) / R_MEAN;
  const d12 = gcDistanceKm(a[0], a[1], b[0], b[1]) / R_MEAN;
  if (d12 === 0) return d13 * R_MEAN;
  const t13 = bearingDeg(a[0], a[1], p[0], p[1]) * DEG;
  const t12 = bearingDeg(a[0], a[1], b[0], b[1]) * DEG;
  const dxt = Math.asin(Math.sin(d13) * Math.sin(t13 - t12));
  const dat = Math.acos(Math.min(1, Math.max(-1, Math.cos(d13) / Math.cos(dxt))));
  const along = Math.cos(t13 - t12) >= 0 ? dat : -dat;
  if (along >= 0 && along <= d12) return Math.abs(dxt) * R_MEAN;
  return Math.min(d13, gcDistanceKm(b[0], b[1], p[0], p[1]) / R_MEAN) * R_MEAN;
}

export interface TrackPoint {
  t: number;
  lon: number;
  lat: number;
}

export function groundTrack(o: OrbitModel, start: number, end: number, stepSec = 30): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let t = start; t <= end; t += stepSec * 1000) {
    const [lon, lat] = subSatellitePoint(o, t);
    out.push({ t, lon, lat });
  }
  return out;
}

export interface Pass {
  /** もっとも近づいた時刻 [ms] */
  t: number;
  /** 地上軌跡からの距離 [km] */
  distanceKm: number;
  /** その時の太陽高度 [度] */
  sunElevation: number;
}

/** 観測幅の中に地点が入った回（パス）の一覧 */
export function findPasses(track: TrackPoint[], target: [number, number], halfSwathKm: number): Pass[] {
  const passes: Pass[] = [];
  let cur: Pass | null = null;
  for (let k = 1; k < track.length; k++) {
    const a = track[k - 1];
    const b = track[k];
    const d = distanceToSegmentKm([a.lon, a.lat], [b.lon, b.lat], target);
    if (d <= halfSwathKm) {
      if (!cur || d < cur.distanceKm) {
        const t = (a.t + b.t) / 2;
        cur = { t, distanceKm: d, sunElevation: solarElevationDeg(target[0], target[1], t) };
      }
    } else if (cur) {
      passes.push(cur);
      cur = null;
    }
  }
  if (cur) passes.push(cur);
  return passes;
}
