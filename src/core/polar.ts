/**
 * 北極域ポーラーステレオ投影 (EPSG:3995: WGS84, 標準緯線 71°N, 中央経線 0°) の計算。
 * JAXA Earth API の TileGenerator は EPSG:4326 のみ対応のため、
 * 北極の海氷データは全体を取得して、ここで Web メルカトルのタイルへ再投影する。
 */
const A = 6378137;
const E = 0.0818191908426215;
const LAT_TS = (71 * Math.PI) / 180;

function tFn(phi: number): number {
  const s = Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - E * s) / (1 + E * s), E / 2);
}
const M_C = Math.cos(LAT_TS) / Math.sqrt(1 - E * E * Math.sin(LAT_TS) ** 2);
const T_C = tFn(LAT_TS);

/** 経度緯度 (度) → EPSG:3995 の x, y (m) */
export function lonLatToPolarNorth(lon: number, lat: number): [number, number] {
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const rho = (A * M_C * tFn(phi)) / T_C;
  return [rho * Math.sin(lam), -rho * Math.cos(lam)];
}

/** Web メルカトルのタイル座標 (z, x, y) と、タイル内のピクセル中心 → 経度緯度 */
export function tilePixelToLonLat(z: number, tx: number, ty: number, px: number, py: number, size: number): [number, number] {
  const n = 2 ** z;
  const x = (tx + (px + 0.5) / size) / n;
  const y = (ty + (py + 0.5) / size) / n;
  const lon = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lon, lat];
}

/** EPSG:3995 の格子データ（全範囲）。範囲は collection.json の bbox */
export interface PolarGrid {
  width: number;
  height: number;
  data: ArrayLike<number>;
  /** [xmin, ymin, xmax, ymax] (m) */
  extent: [number, number, number, number];
}

export const ARCTIC_EXTENT: [number, number, number, number] = [-8388608, -8388608, 8388608, 8388608];

/** 最近傍で値を取り出す（範囲外・欠損は NaN） */
export function samplePolar(grid: PolarGrid, lon: number, lat: number): number {
  if (lat < 0) return NaN;
  const [x, y] = lonLatToPolarNorth(lon, lat);
  const [x0, y0, x1, y1] = grid.extent;
  const i = Math.floor(((x - x0) / (x1 - x0)) * grid.width);
  const j = Math.floor(((y1 - y) / (y1 - y0)) * grid.height);
  if (i < 0 || j < 0 || i >= grid.width || j >= grid.height) return NaN;
  const v = grid.data[i + j * grid.width];
  return typeof v === "number" ? v : NaN;
}
