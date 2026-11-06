import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { LruCache, PersistentCache, pointKey } from "../src/core/cache";

describe("LruCache", () => {
  it("容量を超えると最も古いものから消える", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a を最近使ったことにする
    c.set("c", 3);
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
    expect(c.has("c")).toBe(true);
    expect(c.size).toBe(2);
  });
  it("容量0以下はエラー", () => {
    expect(() => new LruCache(0)).toThrow();
  });
});

describe("pointKey", () => {
  it("座標を丸めて同一条件を共有する", () => {
    expect(pointKey("precip", "2024-01", 139.76712, 35.68123)).toBe(pointKey("precip", "2024-01", 139.7674, 35.6809));
    expect(pointKey("precip", "2024-01", 139.767, 35.681)).not.toBe(pointKey("precip", "2024-02", 139.767, 35.681));
  });
});

describe("PersistentCache", () => {
  it("IndexedDB に保存し、別インスタンスからも読める", async () => {
    const a = new PersistentCache<number>(1000);
    await a.set("k1", 42);
    const b = new PersistentCache<number>(1000);
    expect(await b.get("k1")).toBe(42);
  });
  it("null（欠損）もキャッシュできる", async () => {
    const c = new PersistentCache<number | null>(1000);
    await c.set("nullv", null);
    expect(await c.get("nullv")).toBeNull();
    expect(await c.get("missing")).toBeUndefined();
  });
  it("期限切れは返さない", async () => {
    let now = 1000;
    const c = new PersistentCache<number>(100, () => now);
    await c.set("exp", 1);
    expect(await c.get("exp")).toBe(1);
    now = 2000;
    expect(await c.get("exp")).toBeUndefined();
  });
  it("IndexedDB が無い環境でもメモリで動く", async () => {
    const c = new PersistentCache<number>(1000, () => Date.now(), undefined);
    await c.set("m", 7);
    expect(await c.get("m")).toBe(7);
  });
});
