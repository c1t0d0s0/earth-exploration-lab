export type Category = "weather" | "ocean" | "land" | "soil" | "surface";
export type Temporal = "monthly" | "daily" | "yearly";
export type ValueKind = "observed" | "estimated" | "classified";

export interface ColorMapDef {
  min: number;
  max: number;
  /** je.Colors の名前 ("jet" など) またはカラーコード配列 */
  colors: string | string[];
  log?: boolean;
  logOrigin?: number;
  deleteMin?: boolean;
  deleteMax?: boolean;
}

export interface ClassDef {
  value: number;
  label: string;
  color: string;
  /** 凡例に表示する代表クラス */
  major?: boolean;
}

export interface DatasetDef {
  key: string;
  collectionId: string;
  collectionUrl: string;
  band: string;
  name: string;
  shortName: string;
  icon: string;
  category: Category;
  target: string;
  temporal: Temporal;
  updateFrequency: string;
  /** "YYYY", "YYYY-MM", "YYYY-MM-DD" */
  periodStart: string;
  periodEnd: string | null;
  spatialResolution: string;
  unit: string;
  unitLabel: string;
  /** 表示値 = 生値 + displayOffset (K→℃ 変換など) */
  displayOffset?: number;
  valueKind: ValueKind;
  maxZoom: number;
  projection?: string;
  /** false の場合、地点値・時系列取得に対応しない */
  pointQuery?: boolean;
  colorMap: ColorMapDef | null;
  /** この値未満を透明にする（表示用） */
  transparentBelow?: number;
  classes?: ClassDef[];
  description: { simple: string; detail: string; data: string };
  caution: string;
  source: {
    provider: string;
    satellite: string;
    sensor: string;
    citation: string;
    doi: string | null;
  };
}

export interface TimeMachinePreset {
  id: string;
  title: string;
  icon: string;
  dataset: string;
  bbox: [number, number, number, number];
  dateA: string;
  dateB: string;
  center?: [number, number];
  zoom?: number;
  question: string;
  simple: string;
  detail: string;
  caution: string;
}

export interface LabPreset {
  id: string;
  a: string;
  b: string;
  question: string;
  point: [number, number];
  pointName: string;
  extraPoints?: [number, number, string][];
}

export interface Discovery {
  title: string;
  text: string;
  link: string;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  weather: "気象・降水",
  ocean: "海洋",
  land: "陸地・植生",
  soil: "土壌・水",
  surface: "地表環境",
};

export const VALUE_KIND_LABELS: Record<ValueKind, string> = {
  observed: "観測値（衛星センサーで直接はかった量から算出）",
  estimated: "推定値（観測データからモデルで推定した量）",
  classified: "分類データ（観測から土地の種類などを判定）",
};
