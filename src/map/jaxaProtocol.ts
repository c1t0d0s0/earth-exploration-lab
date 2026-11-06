import { addProtocol } from "maplibre-gl";
import { getDataset } from "../core/datasetRegistry";
import { parseDateKey } from "../core/dates";
import { getColorMap, getPolarGrid, getTileGenerator, isPolar } from "../core/jaxaClient";
import { samplePolar, tilePixelToLonLat } from "../core/polar";
import type { DatasetDef } from "../core/types";

const TILE = 256;

/** 極域データ：全体の格子から Web メルカトルのタイルを作る */
async function renderPolarTile(ds: DatasetDef, dateKey: string, z: number, x: number, y: number): Promise<ImageBitmap> {
  const [grid, cmap] = await Promise.all([getPolarGrid(ds, parseDateKey(dateKey)), getColorMap(ds)]);
  const img = new ImageData(TILE, TILE);
  // 南端が北緯40°より南のタイルは描かない（北極データの範囲外）
  const [, southLat] = tilePixelToLonLat(z, x, y, 0, TILE - 1, TILE);
  if (southLat < 40 && tilePixelToLonLat(z, x, y, 0, 0, TILE)[1] < 40) return createImageBitmap(img);
  for (let py = 0; py < TILE; py++) {
    for (let px = 0; px < TILE; px++) {
      const [lon, lat] = tilePixelToLonLat(z, x, y, px, py, TILE);
      const v = samplePolar(grid, lon, lat);
      if (Number.isNaN(v)) continue;
      const c = cmap.getColor(v);
      const o = (px + py * TILE) * 4;
      img.data[o] = c.r;
      img.data[o + 1] = c.g;
      img.data[o + 2] = c.b;
      img.data[o + 3] = c.a;
    }
  }
  return createImageBitmap(img);
}

/** タイル取得状況（読み込み中表示・エラー表示に使う） */
export interface TileStatus {
  pending: number;
  errors: number;
  lastError: string | null;
}

const status: TileStatus = { pending: 0, errors: 0, lastError: null };
const listeners = new Set<(s: TileStatus) => void>();

export function onTileStatus(fn: (s: TileStatus) => void): () => void {
  listeners.add(fn);
  fn({ ...status });
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn({ ...status });
}

export function resetTileErrors(): void {
  status.errors = 0;
  status.lastError = null;
  emit();
}

let emptyTile: Promise<ImageBitmap> | null = null;
function transparentTile(): Promise<ImageBitmap> {
  if (!emptyTile) emptyTile = createImageBitmap(new ImageData(1, 1));
  return emptyTile;
}

/** jaxa://{datasetKey}/{dateKey}/{z}/{x}/{y} */
export function tileUrl(datasetKey: string, dateKey: string): string {
  return `jaxa://${datasetKey}/${dateKey}/{z}/{x}/{y}`;
}

export function parseTileUrl(url: string): { datasetKey: string; dateKey: string; z: number; x: number; y: number } | null {
  const m = /^jaxa:\/\/([^/]+)\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(url);
  if (!m) return null;
  return { datasetKey: m[1], dateKey: m[2], z: Number(m[3]), x: Number(m[4]), y: Number(m[5]) };
}

let registered = false;

export function registerJaxaProtocol(): void {
  if (registered) return;
  registered = true;
  addProtocol("jaxa", async (params, abortController) => {
    const p = parseTileUrl(params.url);
    const ds = p && getDataset(p.datasetKey);
    if (!p || !ds) throw new Error(`不正なタイルURLです: ${params.url}`);
    status.pending++;
    emit();
    try {
      if (isPolar(ds)) return { data: await renderPolarTile(ds, p.dateKey, p.z, p.x, p.y) };
      const tg = await getTileGenerator(ds, p.dateKey);
      const canvas = await tg.getCanvas(p.x, p.y, p.z, abortController.signal);
      return { data: await createImageBitmap(canvas) };
    } catch (e) {
      if ((e as Error).name === "AbortError" || abortController.signal.aborted) throw e;
      status.errors++;
      status.lastError = `${ds.shortName}: ${(e as Error).message ?? e}`;
      console.warn("[jaxa tile]", params.url, e);
      // 欠損タイルは透明にして、地図の他の部分は表示を続ける
      return { data: await transparentTile() };
    } finally {
      status.pending--;
      emit();
    }
  });
}
