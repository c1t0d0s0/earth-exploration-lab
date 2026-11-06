import { onTileStatus, resetTileErrors } from "../map/jaxaProtocol";
import { h } from "./dom";

/** 地図上の読み込み中・エラー表示 */
export function mapStatus(onReload: () => void): { el: HTMLElement; destroy: () => void } {
  const text = h("span", null);
  const reload = h("button", { type: "button", class: "btn btn-sm", hidden: true, onclick: () => (resetTileErrors(), onReload()) }, "再読み込み");
  const el = h("div", { class: "map-status", role: "status", "aria-live": "polite" }, text, reload);
  const off = onTileStatus((s) => {
    if (s.errors) {
      el.dataset.state = "error";
      text.textContent = `⚠️ 一部のデータを取得できませんでした（${s.errors}件）`;
      el.title = s.lastError ?? "";
      reload.hidden = false;
    } else if (s.pending > 0) {
      el.dataset.state = "loading";
      text.textContent = "🛰️ 衛星データを読み込み中…";
      reload.hidden = true;
    } else {
      el.dataset.state = "idle";
      text.textContent = "";
      reload.hidden = true;
    }
  });
  return { el, destroy: off };
}
