import { getDates, getPointValue } from "./jaxaClient";
import { toDateKey } from "./dates";
import { sampleEvenly } from "./stats";
import type { DatasetDef } from "./types";

export interface SeriesPoint {
  key: string;
  date: Date;
  /** 生の値 */
  value: number | null;
}

export interface SeriesOptions {
  maxPoints?: number;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, partial: SeriesPoint[]) => void;
}

/** 限られた同時実行数でタスクを実行する */
export async function runLimited<T>(tasks: (() => Promise<T>)[], limit: number, signal?: AbortSignal, onEach?: (i: number, v: T) => void): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const i = next++;
      results[i] = await tasks[i]();
      onEach?.(i, results[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** 地点の時系列を取得する（API には時系列関数が無いため日時ごとに取得し、キャッシュする） */
export async function fetchPointSeries(
  ds: DatasetDef,
  lon: number,
  lat: number,
  start: Date,
  end: Date,
  opts: SeriesOptions = {},
): Promise<SeriesPoint[]> {
  const { maxPoints = 120, concurrency = 4, signal, onProgress } = opts;
  const dates = sampleEvenly(await getDates(ds, start, end), maxPoints);
  const out: (SeriesPoint | undefined)[] = new Array(dates.length);
  let done = 0;
  const tasks = dates.map((d) => async () => {
    try {
      const pv = await getPointValue(ds, d, lon, lat, signal);
      return { key: toDateKey(d, ds.temporal), date: d, value: pv.value } as SeriesPoint;
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      return { key: toDateKey(d, ds.temporal), date: d, value: null } as SeriesPoint;
    }
  });
  await runLimited(tasks, concurrency, signal, (i, v) => {
    out[i] = v;
    done++;
    onProgress?.(done, dates.length, out.filter((p): p is SeriesPoint => !!p));
  });
  return out as SeriesPoint[];
}
