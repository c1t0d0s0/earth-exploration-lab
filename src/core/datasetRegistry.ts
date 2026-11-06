import raw from "../data/datasets.json";
import themesRaw from "../data/themes.json";
import type { Category, DatasetDef, Discovery, LabPreset, TimeMachinePreset } from "./types";

interface RawFile {
  baseUrl: string;
  datasets: Omit<DatasetDef, "collectionUrl">[];
}

const REQUIRED: (keyof DatasetDef)[] = [
  "key", "collectionId", "band", "name", "shortName", "category", "temporal",
  "periodStart", "unit", "unitLabel", "valueKind", "maxZoom", "description", "source",
];

/** datasets.json を検証して DatasetDef[] に変換する（テストからも利用） */
export function buildRegistry(file: RawFile): DatasetDef[] {
  const seen = new Set<string>();
  return file.datasets.map((d) => {
    for (const k of REQUIRED) {
      if ((d as Record<string, unknown>)[k] === undefined) {
        throw new Error(`datasets.json: ${d.key ?? "?"} に ${k} がありません`);
      }
    }
    if (seen.has(d.key)) throw new Error(`datasets.json: key が重複しています: ${d.key}`);
    seen.add(d.key);
    if (d.valueKind === "classified") {
      if (!d.classes?.length) throw new Error(`datasets.json: 分類データ ${d.key} に classes がありません`);
    } else if (!d.colorMap) {
      throw new Error(`datasets.json: ${d.key} に colorMap がありません`);
    }
    return { ...d, collectionUrl: `${file.baseUrl}${d.collectionId}/collection.json` } as DatasetDef;
  });
}

export const DATASETS: DatasetDef[] = buildRegistry(raw as unknown as RawFile);

const byKey = new Map(DATASETS.map((d) => [d.key, d]));

export function getDataset(key: string | null | undefined): DatasetDef | undefined {
  return key ? byKey.get(key) : undefined;
}

export function datasetsByCategory(): Map<Category, DatasetDef[]> {
  const m = new Map<Category, DatasetDef[]>();
  for (const d of DATASETS) {
    if (!m.has(d.category)) m.set(d.category, []);
    m.get(d.category)!.push(d);
  }
  return m;
}

/** 数値（連続量）データで、地点値・時系列に対応しているか */
export function supportsSeries(d: DatasetDef): boolean {
  // 極域投影データは時系列のたびに全体を取得する必要があり重いため対象外
  const polar = !!d.projection && d.projection !== "EPSG:4326";
  return d.valueKind !== "classified" && d.pointQuery !== false && d.temporal !== "yearly" && !polar;
}

export function supportsPoint(d: DatasetDef): boolean {
  return d.pointQuery !== false;
}

const themes = themesRaw as unknown as {
  timeMachine: TimeMachinePreset[];
  labPresets: LabPreset[];
  weeklyDiscoveries: Discovery[];
};

export const TIME_MACHINE_PRESETS = themes.timeMachine;
export const LAB_PRESETS = themes.labPresets;
export const WEEKLY_DISCOVERIES = themes.weeklyDiscoveries;
