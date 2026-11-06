import { VALUE_KIND_LABELS, type DatasetDef } from "../core/types";
import { h, setChildren, uid } from "./dom";

const TEMPORAL_LABEL = { monthly: "1か月", daily: "1日", yearly: "1年" } as const;

/** §6.2 の3段階説明（かんたん / くわしく / データ）をタブで表示 */
export function renderInfoPanel(container: HTMLElement, ds: DatasetDef, extra?: { availableLast?: string }): void {
  const tabs = [
    { id: "simple", label: "かんたん", body: () => h("p", null, ds.description.simple) },
    { id: "detail", label: "くわしく", body: () => h("div", null, h("p", null, ds.description.detail), h("p", { class: "caution" }, "⚠️ ", ds.caution)) },
    { id: "data", label: "データ", body: () => dataTable(ds, extra) },
  ];
  const base = uid("info");
  const tablist = h("div", { class: "tabs", role: "tablist", "aria-label": "説明のくわしさ" });
  const panel = h("div", { class: "tab-panel", role: "tabpanel", tabindex: "0" });
  const select = (i: number, focus = false) => {
    tablist.querySelectorAll("button").forEach((b, j) => {
      b.setAttribute("aria-selected", String(i === j));
      b.tabIndex = i === j ? 0 : -1;
      if (i === j && focus) b.focus();
    });
    panel.setAttribute("aria-labelledby", `${base}-${tabs[i].id}`);
    setChildren(panel, tabs[i].body());
  };
  tabs.forEach((t, i) =>
    tablist.appendChild(
      h(
        "button",
        {
          id: `${base}-${t.id}`,
          role: "tab",
          type: "button",
          onclick: () => select(i),
          onkeydown: (e: Event) => {
            const k = (e as KeyboardEvent).key;
            if (k === "ArrowRight") select((i + 1) % tabs.length, true);
            if (k === "ArrowLeft") select((i + tabs.length - 1) % tabs.length, true);
          },
        },
        t.label,
      ),
    ),
  );
  setChildren(container, h("h2", { class: "panel-title" }, `${ds.icon} ${ds.name}`), h("p", { class: "target" }, `何をはかっている？ → ${ds.target}`), tablist, panel);
  select(0);
}

function dataTable(ds: DatasetDef, extra?: { availableLast?: string }) {
  const rows: [string, string | Node][] = [
    ["データセットID", h("code", null, ds.collectionId)],
    ["バンド", ds.band],
    ["観測対象", ds.target],
    ["観測期間", `${ds.periodStart} 〜 ${ds.periodEnd ?? (extra?.availableLast ? `${extra.availableLast}（最新）` : "現在")}`],
    ["更新頻度", ds.updateFrequency],
    ["空間解像度", ds.spatialResolution],
    ["時間解像度", TEMPORAL_LABEL[ds.temporal]],
    ["単位", ds.unitLabel + (ds.displayOffset ? `（元データ: ${ds.unit}）` : "")],
    ["値の種類", VALUE_KIND_LABELS[ds.valueKind]],
    ["衛星・センサー", `${ds.source.satellite} / ${ds.source.sensor}`],
    ["提供", ds.source.provider],
    ["出典", h("span", null, ds.source.citation, ds.source.doi ? h("span", null, " DOI: ", h("a", { href: `https://doi.org/${ds.source.doi}`, target: "_blank", rel: "noopener" }, ds.source.doi)) : null)],
    ["利用上の注意", ds.caution],
    ["データソース", h("a", { href: "https://data.earth.jaxa.jp/ja/", target: "_blank", rel: "noopener" }, "JAXA Earth API")],
  ];
  return h("div", null, h("p", null, ds.description.data), h("table", { class: "meta-table" }, h("tbody", null, rows.map(([k, v]) => h("tr", null, h("th", { scope: "row" }, k), h("td", null, v))))));
}
