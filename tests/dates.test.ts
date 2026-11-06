import { describe, expect, it } from "vitest";
import { defaultRange, formatDateJa, parseDateKey, step, toDateKey } from "../src/core/dates";
import { getDataset } from "../src/core/datasetRegistry";

describe("dates", () => {
  it("日付キーの相互変換（UTC）", () => {
    expect(parseDateKey("2024-07").toISOString()).toBe("2024-07-01T00:00:00.000Z");
    expect(parseDateKey("2019").toISOString()).toBe("2019-01-01T00:00:00.000Z");
    expect(toDateKey(parseDateKey("2024-07-15"), "monthly")).toBe("2024-07");
    expect(toDateKey(parseDateKey("2024-07-15"), "daily")).toBe("2024-07-15");
    expect(toDateKey(parseDateKey("2024-07-15"), "yearly")).toBe("2024");
    expect(() => parseDateKey("2024/07")).toThrow();
  });
  it("日本語表記", () => {
    expect(formatDateJa(parseDateKey("2024-07"), "monthly")).toBe("2024年7月");
  });
  it("月またぎ・年またぎのステップ", () => {
    expect(toDateKey(step(parseDateKey("2024-12"), "monthly"), "monthly")).toBe("2025-01");
    expect(toDateKey(step(parseDateKey("2024-02-28"), "daily", 2), "daily")).toBe("2024-03-01");
  });
  it("既定の表示期間は観測開始日より前にならない", () => {
    const sst = getDataset("sst")!; // 2024-01 開始
    const r = defaultRange(sst, parseDateKey("2024-06"));
    expect(toDateKey(r.start, "monthly")).toBe("2024-01");
    const precip = getDataset("precip")!;
    const r2 = defaultRange(precip, parseDateKey("2025-12"));
    expect(toDateKey(r2.start, "monthly")).toBe("2023-01");
  });
});
