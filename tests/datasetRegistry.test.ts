import { describe, expect, it } from "vitest";
import raw from "../src/data/datasets.json";
import themes from "../src/data/themes.json";
import { buildRegistry, DATASETS, getDataset, supportsSeries } from "../src/core/datasetRegistry";
import { parseDateKey } from "../src/core/dates";
import { parseTileUrl, tileUrl } from "../src/map/jaxaProtocol";

describe("datasets.json", () => {
  it("すべてのデータセットが検証を通り、collectionUrl が組み立てられる", () => {
    expect(DATASETS.length).toBeGreaterThanOrEqual(8);
    for (const d of DATASETS) {
      expect(d.collectionUrl).toMatch(/^https:\/\/.+\/collection\.json$/);
      expect(d.collectionUrl).toContain(d.collectionId);
      expect(() => parseDateKey(d.periodStart)).not.toThrow();
      expect(d.description.simple.length).toBeGreaterThan(10);
      expect(d.description.detail.length).toBeGreaterThan(10);
      expect(d.description.data.length).toBeGreaterThan(5);
      expect(d.source.citation.length).toBeGreaterThan(5);
    }
  });
  it("要件 §3.1 のカテゴリをすべて含む", () => {
    const cats = new Set(DATASETS.map((d) => d.category));
    for (const c of ["weather", "ocean", "land", "soil", "surface"]) expect(cats.has(c as never)).toBe(true);
  });
  it("連続量にはカラーマップ、分類データにはクラス定義がある", () => {
    for (const d of DATASETS) {
      if (d.valueKind === "classified") expect(d.classes!.length).toBeGreaterThan(0);
      else expect(d.colorMap!.max).toBeGreaterThan(d.colorMap!.min);
    }
  });
  it("必須項目が欠けていればエラー", () => {
    const bad = { baseUrl: "x/", datasets: [{ ...(raw as any).datasets[0], band: undefined }] };
    expect(() => buildRegistry(bad as any)).toThrow(/band/);
  });
  it("key の重複はエラー", () => {
    const d0 = (raw as any).datasets[0];
    expect(() => buildRegistry({ baseUrl: "x/", datasets: [d0, d0] } as any)).toThrow(/重複/);
  });
  it("分類・年別・極域データは時系列グラフ対象外", () => {
    expect(supportsSeries(getDataset("precip")!)).toBe(true);
    expect(supportsSeries(getDataset("landcover")!)).toBe(false);
    expect(supportsSeries(getDataset("seaice")!)).toBe(false);
  });
});

describe("themes.json", () => {
  it("プリセットが参照するデータセットが存在し、日付が読める", () => {
    for (const p of themes.timeMachine) {
      expect(getDataset(p.dataset), p.id).toBeDefined();
      expect(() => parseDateKey(p.dateA)).not.toThrow();
      expect(() => parseDateKey(p.dateB)).not.toThrow();
      expect(p.bbox[0]).toBeLessThan(p.bbox[2]);
      expect(p.bbox[1]).toBeLessThan(p.bbox[3]);
    }
    for (const p of themes.labPresets) {
      expect(getDataset(p.a), p.id).toBeDefined();
      expect(getDataset(p.b), p.id).toBeDefined();
    }
  });
});

describe("tile URL", () => {
  it("往復で同じ値になる", () => {
    const u = tileUrl("precip", "2024-07").replace("{z}", "3").replace("{x}", "5").replace("{y}", "2");
    expect(parseTileUrl(u)).toEqual({ datasetKey: "precip", dateKey: "2024-07", z: 3, x: 5, y: 2 });
    expect(parseTileUrl("https://example.com/1/2/3")).toBeNull();
  });
});
