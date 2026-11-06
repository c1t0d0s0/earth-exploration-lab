import type * as JE from "../vendor/jaxa.earth.esm";
import { LruCache, PersistentCache, pointKey } from "./cache";
import { parseDateKey, toDateKey } from "./dates";
import { ARCTIC_EXTENT, samplePolar, type PolarGrid } from "./polar";
import { isValid } from "./stats";
import type { ColorMapDef, DatasetDef } from "./types";

export type JeModule = typeof JE;

/**
 * JAXA Earth API for JavaScript は再配布せず、公式URLから実行時に読み込む。
 * （型定義のみ src/vendor に同梱。初期表示を軽くする効果もある）
 */
export const JAXA_LIB_URL = "https://data.earth.jaxa.jp/api/javascript/v2.0.1/jaxa.earth.esm.js";

let jePromise: Promise<JeModule> | null = null;

export function loadJe(): Promise<JeModule> {
  if (!jePromise) {
    jePromise = (import(/* @vite-ignore */ JAXA_LIB_URL) as Promise<JeModule>).catch((e) => {
      jePromise = null;
      throw new Error(`JAXA Earth API の読み込みに失敗しました。ネットワーク接続を確認してください。(${(e as Error).message})`);
    });
  }
  return jePromise;
}

/** 表示用カラーマップ（transparentBelow を考慮） */
export function displayColorMap(ds: DatasetDef): ColorMapDef | null {
  const cm = ds.colorMap;
  if (!cm) return null;
  if (ds.transparentBelow == null) return cm;
  return { ...cm, min: Math.max(cm.min, ds.transparentBelow), deleteMin: true };
}

export function toColorMapObject(cm: ColorMapDef): JE.image.ColorMapObject {
  return {
    min: cm.min,
    max: cm.max,
    colors: cm.colors as JE.image.ColorMapObject["colors"],
    log: cm.log,
    logOrigin: cm.logOrigin,
    deleteMin: cm.deleteMin,
    deleteMax: cm.deleteMax,
  };
}

// ---------------------------------------------------------------- collections

const collections = new Map<string, Promise<JE.ImageCollection>>();

export function getImageCollection(ds: DatasetDef): Promise<JE.ImageCollection> {
  let p = collections.get(ds.key);
  if (!p) {
    p = loadJe().then(async (je) => {
      const ic = new je.ImageCollection({ collectionUrl: ds.collectionUrl });
      await ic.init();
      return ic;
    });
    p.catch(() => collections.delete(ds.key));
    collections.set(ds.key, p);
  }
  return p;
}

export interface AvailableRange {
  first: Date;
  last: Date;
}

const ranges = new Map<string, Promise<AvailableRange>>();

/** 実際に利用できる最初と最新の日時（データセット定義より API の情報を優先） */
export function getAvailableRange(ds: DatasetDef): Promise<AvailableRange> {
  let p = ranges.get(ds.key);
  if (!p) {
    p = getImageCollection(ds).then((ic) => {
      let first = ic.first();
      let last = ic.last();
      const defStart = parseDateKey(ds.periodStart);
      if (!(first instanceof Date) || Number.isNaN(first.getTime())) first = defStart;
      if (!(last instanceof Date) || Number.isNaN(last.getTime())) last = ds.periodEnd ? parseDateKey(ds.periodEnd) : new Date();
      return { first, last };
    });
    p.catch(() => ranges.delete(ds.key));
    ranges.set(ds.key, p);
  }
  return p;
}

const dateLists = new LruCache<string, Promise<Date[]>>(64);

/** start 以上 end 以下でデータが存在する日時の一覧 */
export function getDates(ds: DatasetDef, start: Date, end: Date): Promise<Date[]> {
  const key = `${ds.key}|${start.toISOString()}|${end.toISOString()}`;
  let p = dateLists.get(key);
  if (!p) {
    p = getImageCollection(ds).then((ic) => ic.getDateAll(start, new Date(end.getTime() + 1000)));
    p.catch(() => dateLists.delete(key));
    dateLists.set(key, p);
  }
  return p;
}

const images = new LruCache<string, Promise<JE.Image>>(96);

/** 指定日時の Image（データが無い時刻は直前の時刻に切り下げられる） */
export function getImage(ds: DatasetDef, date: Date): Promise<JE.Image> {
  const key = `${ds.key}|${toDateKey(date, ds.temporal)}`;
  let p = images.get(key);
  if (!p) {
    p = getImageCollection(ds).then((ic) => ic.getImage({ date, band: ds.band }));
    p.catch(() => images.delete(key));
    images.set(key, p);
  }
  return p;
}

type DataObjectOptions = Parameters<JE.Image["getDataObject"]>[0];
const imageQueues = new WeakMap<JE.Image, Promise<unknown>>();

/**
 * 同じ Image に対して getDataObject を同時に呼ぶと、先の呼び出しが null で終わる（API の仕様）。
 * そのため Image ごとに順番に実行する。
 */
export function imageDataObject(im: JE.Image, opts: DataObjectOptions): Promise<JE.data.DataObject> {
  const prev = imageQueues.get(im) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const d = await im.getDataObject(opts);
    if (!d) throw new Error("データを取得できませんでした（応答が空でした）");
    return d;
  });
  imageQueues.set(im, run);
  return run;
}

/** 全球（等緯度経度）の格子データ。発見・クイズ・ランキングで共通に使う */
export interface GlobalGrid {
  width: number;
  height: number;
  data: ArrayLike<number>;
  bbox: [number, number, number, number];
  /** 実際に使われたデータの日時 */
  date: Date;
}

const globalGrids = new LruCache<string, Promise<GlobalGrid>>(48);

export function getGlobalGrid(ds: DatasetDef, date: Date, width = 360, height = 180): Promise<GlobalGrid> {
  if (isPolar(ds)) return Promise.reject(new Error(`${ds.shortName} は極域投影のため全球格子に対応していません`));
  const key = `${ds.key}|${toDateKey(date, ds.temporal)}|${width}x${height}`;
  let p = globalGrids.get(key);
  if (!p) {
    p = getImage(ds, date).then(async (im) => {
      const bbox: [number, number, number, number] = [-180, -90, 180, 90];
      const d = await imageDataObject(im, { bbox, width, height });
      return { width: d.width, height: d.height, data: d.data, bbox, date: im.getDate() };
    });
    p.catch(() => globalGrids.delete(key));
    globalGrids.set(key, p);
  }
  return p;
}

// ---------------------------------------------------------------- tiles

const tileGenerators = new LruCache<string, Promise<JE.TileGenerator>>(24);

export function getTileGenerator(ds: DatasetDef, dateKey: string): Promise<JE.TileGenerator> {
  const key = `${ds.key}|${dateKey}`;
  let p = tileGenerators.get(key);
  if (!p) {
    p = loadJe().then(async (je) => {
      const cm = displayColorMap(ds);
      const tg = new je.TileGenerator({
        collectionUrl: ds.collectionUrl,
        band: ds.band,
        date: parseDateKey(dateKey),
        colorMapObject: cm ? toColorMapObject(cm) : undefined,
        tileSize: 256,
        delay: 150,
      });
      await tg.init();
      return tg;
    });
    p.catch(() => tileGenerators.delete(key));
    tileGenerators.set(key, p);
  }
  return p;
}

// ---------------------------------------------------------------- values

/** 地点値キャッシュ（過去データは基本的に変わらないため7日間保持） */
const pointCache = new PersistentCache<number | null>(7 * 86400000);

export interface PointValue {
  /** 生の値（NaN・範囲外は null） */
  value: number | null;
  /** 実際に使われたデータの日時 */
  date: Date;
}

export function isPolar(ds: DatasetDef): boolean {
  return !!ds.projection && ds.projection !== "EPSG:4326";
}

export async function getPointValue(ds: DatasetDef, date: Date, lon: number, lat: number, signal?: AbortSignal): Promise<PointValue> {
  if (ds.pointQuery === false) throw new Error(`${ds.shortName} は地点の値の取得に対応していません`);
  const im = await getImage(ds, date);
  const actual = im.getDate();
  const dk = toDateKey(actual, ds.temporal);
  const key = pointKey(ds.key, dk, lon, lat);
  const cached = await pointCache.get(key);
  if (cached !== undefined) return { value: cached, date: actual };
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  let raw: number;
  if (isPolar(ds)) {
    raw = samplePolar(await getPolarGrid(ds, actual), lon, lat);
  } else {
    // API の制約で幅・高さは 10px 以上。地点を中心とする小さな範囲を取り、地点の値を読む
    const e = 0.005;
    const dobj = await imageDataObject(im, { bbox: [lon - e, lat - e, lon + e, lat + e], width: 10, height: 10 });
    const je = await loadJe();
    raw = new je.data.Inspector(dobj).getValueByCoordinateXY(lon, lat);
    if (dobj.photometricInterpretation === 2 && raw === 0) raw = NaN;
  }
  const value = isValid(raw) ? raw : null;
  await pointCache.set(key, value);
  return { value, date: actual };
}

// ---------------------------------------------------------------- polar (EPSG:3995)

const polarGrids = new LruCache<string, Promise<PolarGrid>>(4);
/** 極域データを取得する格子の大きさ（約16km/px。配信の最大解像度は約8km） */
const POLAR_GRID_SIZE = 1024;

/** 極域投影データの全体を取得する（TileGenerator が EPSG:4326 のみ対応のため） */
export function getPolarGrid(ds: DatasetDef, date: Date): Promise<PolarGrid> {
  const key = `${ds.key}|${toDateKey(date, ds.temporal)}`;
  let p = polarGrids.get(key);
  if (!p) {
    p = getImage(ds, date).then(async (im) => {
      // 極域データの bbox は経度緯度ではなく投影座標 (m) で指定する
      const dobj = await imageDataObject(im, { bbox: ARCTIC_EXTENT, width: POLAR_GRID_SIZE, height: POLAR_GRID_SIZE });
      return { width: dobj.width, height: dobj.height, data: dobj.data, extent: ARCTIC_EXTENT };
    });
    p.catch(() => polarGrids.delete(key));
    polarGrids.set(key, p);
  }
  return p;
}

const colorMaps = new Map<string, Promise<JE.image.ColorMap>>();
export function getColorMap(ds: DatasetDef): Promise<JE.image.ColorMap> {
  let p = colorMaps.get(ds.key);
  if (!p) {
    p = loadJe().then((je) => new je.image.ColorMap(toColorMapObject(displayColorMap(ds)!)));
    colorMaps.set(ds.key, p);
  }
  return p;
}

export interface RegionSummary {
  date: Date;
  mean: number | null;
  validRatio: number;
  /** 分類データの場合：クラス値ごとの割合 (0-1) */
  classShares?: Map<number, number>;
}

/** 範囲内の平均値（分類データはクラス別の割合）。表示用の簡易計算で、面積の重みは考慮しない */
export async function getRegionSummary(
  ds: DatasetDef,
  date: Date,
  bbox: [number, number, number, number],
  size = 96,
): Promise<RegionSummary> {
  const im = await getImage(ds, date);
  let data: ArrayLike<number>;
  if (isPolar(ds)) {
    const grid = await getPolarGrid(ds, im.getDate());
    const arr = new Float32Array(size * size);
    for (let j = 0; j < size; j++) {
      const lat = bbox[3] - ((j + 0.5) / size) * (bbox[3] - bbox[1]);
      for (let i = 0; i < size; i++) arr[i + j * size] = samplePolar(grid, bbox[0] + ((i + 0.5) / size) * (bbox[2] - bbox[0]), lat);
    }
    data = arr;
  } else {
    data = (await imageDataObject(im, { bbox, width: size, height: size })).data;
  }
  let n = 0;
  let sum = 0;
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!isValid(v)) continue;
    if (ds.valueKind === "classified") {
      if (v === 0) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    } else {
      sum += v;
    }
    n++;
  }
  const res: RegionSummary = { date: im.getDate(), mean: n && ds.valueKind !== "classified" ? sum / n : null, validRatio: n / data.length };
  if (ds.valueKind === "classified" && n) {
    res.classShares = new Map([...counts].map(([k, c]) => [k, c / n]));
  }
  return res;
}

/** 全体図などの小さな画像を canvas として取得 */
export async function getOverviewCanvas(
  ds: DatasetDef,
  date: Date | undefined,
  width: number,
  height: number,
  bbox: [number, number, number, number] = [-180, -90, 180, 90],
): Promise<{ canvas: HTMLCanvasElement; date: Date }> {
  const je = await loadJe();
  const dobj = await je.getDataObject({ collectionUrl: ds.collectionUrl, band: ds.band, date, bbox, width, height });
  const cm = displayColorMap(ds);
  const colorMap = new je.image.ColorMap(cm ? toColorMapObject(cm) : { min: 0, max: 255 });
  return { canvas: je.image.createCanvas(dobj, colorMap), date: dobj.date };
}

/** 生値 → 表示値（K→℃ など） */
export function toDisplay(ds: DatasetDef, raw: number | null): number | null {
  if (raw == null) return null;
  return raw + (ds.displayOffset ?? 0);
}

export function classLabel(ds: DatasetDef, raw: number | null): string {
  if (raw == null) return "データなし";
  const c = ds.classes?.find((k) => k.value === Math.round(raw));
  return c ? c.label : `分類 ${raw}`;
}
