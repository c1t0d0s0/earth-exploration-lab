import { describe, expect, it } from "vitest";
import { claimReload, isChunkLoadError, RELOAD_GUARD_MS } from "../src/chunkReload";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("古いページ対策の再読み込み", () => {
  it("1回目は再読み込みし、直後の2回目はしない（無限ループ防止）", () => {
    const st = mem();
    expect(claimReload(1_000_000, st)).toBe(true);
    expect(claimReload(1_000_000 + 5_000, st)).toBe(false);
    // 時間がたてば、次のデプロイのときにまた再読み込みできる
    expect(claimReload(1_000_000 + RELOAD_GUARD_MS + 1, st)).toBe(true);
  });
  it("sessionStorage が使えない環境では再読み込みしない", () => {
    expect(claimReload(0, undefined)).toBe(false);
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => {} };
    expect(claimReload(0, broken)).toBe(false);
  });
  it("各ブラウザの動的 import 失敗メッセージを見分ける", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/dataLab-C1IUrvT9.js"))).toBe(true); // Chrome
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true); // Safari
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: https://x/a.js"))).toBe(true); // Firefox
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/chart.css"))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
  });
});
