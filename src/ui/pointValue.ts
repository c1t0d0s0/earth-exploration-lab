import { classLabel, getPointValue, toDisplay } from "../core/jaxaClient";
import { formatDateJa } from "../core/dates";
import { formatNumber } from "../core/stats";
import type { DatasetDef } from "../core/types";

export function formatValue(ds: DatasetDef, raw: number | null): string {
  if (ds.valueKind === "classified") return classLabel(ds, raw);
  if (raw == null) return "データなし";
  return `${formatNumber(toDisplay(ds, raw))} ${ds.unitLabel}`;
}

export function formatLngLat(lng: number, lat: number): string {
  const ew = lng >= 0 ? "東経" : "西経";
  const ns = lat >= 0 ? "北緯" : "南緯";
  return `${ns}${Math.abs(lat).toFixed(2)}° ${ew}${Math.abs(lng).toFixed(2)}°`;
}

/** 地点の値を説明文つきで返す */
export async function describePoint(ds: DatasetDef, date: Date, lng: number, lat: number): Promise<string> {
  if (ds.pointQuery === false) return `${ds.shortName} は地点の値の表示に対応していません。`;
  try {
    const pv = await getPointValue(ds, date, lng, lat);
    const note = pv.value == null ? "（雲・観測範囲外などで値がありません）" : "";
    return `${ds.shortName}: ${formatValue(ds, pv.value)} ${note}\n${formatDateJa(pv.date, ds.temporal)}のデータ`;
  } catch (e) {
    return `値を取得できませんでした: ${(e as Error).message}`;
  }
}

/** 経度を -180〜180 に正規化（地図を何周もした場合の対策） */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}
