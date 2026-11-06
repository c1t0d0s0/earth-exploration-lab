import type { DatasetDef, Temporal } from "./types";

/** "YYYY" / "YYYY-MM" / "YYYY-MM-DD" を UTC の Date に変換 */
export function parseDateKey(s: string): Date {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s.trim());
  if (!m) throw new Error(`日付の形式が正しくありません: ${s}`);
  return new Date(Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** データセットの時間解像度に合わせた日付キー */
export function toDateKey(d: Date, temporal: Temporal): string {
  const y = d.getUTCFullYear();
  if (temporal === "yearly") return `${y}`;
  const m = `${y}-${pad(d.getUTCMonth() + 1)}`;
  if (temporal === "monthly") return m;
  return `${m}-${pad(d.getUTCDate())}`;
}

export function formatDateJa(d: Date, temporal: Temporal): string {
  const y = d.getUTCFullYear();
  if (temporal === "yearly") return `${y}年`;
  if (temporal === "monthly") return `${y}年${d.getUTCMonth() + 1}月`;
  return `${y}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

/** 時間解像度ごとの「1ステップ」 */
export function step(d: Date, temporal: Temporal, n = 1): Date {
  if (temporal === "yearly") return new Date(Date.UTC(d.getUTCFullYear() + n, 0, 1));
  if (temporal === "monthly") return addMonths(d, n);
  return addDays(d, n);
}

export function periodStartDate(ds: DatasetDef): Date {
  return parseDateKey(ds.periodStart);
}

/** 既定の表示期間：月別は直近3年、日別は直近60日、年別は全期間 */
export function defaultRange(ds: DatasetDef, last: Date): { start: Date; end: Date } {
  const first = periodStartDate(ds);
  let start: Date;
  if (ds.temporal === "monthly") start = addMonths(last, -35);
  else if (ds.temporal === "daily") start = addDays(last, -59);
  else start = first;
  if (start < first) start = first;
  return { start, end: last };
}

export function clampDate(d: Date, min: Date, max: Date): Date {
  return d < min ? min : d > max ? max : d;
}

/** <input type="month|date|number"> の種類と値 */
export function inputTypeFor(temporal: Temporal): "month" | "date" | "number" {
  return temporal === "monthly" ? "month" : temporal === "daily" ? "date" : "number";
}

export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
