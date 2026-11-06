import { displayColorMap, loadJe, toColorMapObject } from "../core/jaxaClient";
import { formatNumber } from "../core/stats";
import type { DatasetDef } from "../core/types";
import { h, setChildren } from "./dom";

function ticks(min: number, max: number, log: boolean | undefined): number[] {
  if (log && min > 0) {
    const out: number[] = [];
    for (let e = Math.ceil(Math.log10(min)); e <= Math.floor(Math.log10(max)); e++) out.push(10 ** e);
    if (out[0] !== min) out.unshift(min);
    if (out[out.length - 1] !== max) out.push(max);
    return out;
  }
  return [0, 0.25, 0.5, 0.75, 1].map((t) => min + (max - min) * t);
}

/** 凡例（カラーバー＋数値目盛＋単位）。分類データは色見本の一覧 */
export async function renderLegend(container: HTMLElement, ds: DatasetDef, opts: { compact?: boolean } = {}): Promise<void> {
  container.classList.add("legend");
  if (ds.classes) {
    const shown = ds.classes.filter((c) => c.major);
    setChildren(
      container,
      h("div", { class: "legend-title" }, `${ds.icon} ${ds.shortName}`),
      h(
        "ul",
        { class: "legend-classes", "aria-label": `${ds.shortName}の凡例` },
        shown.map((c) => h("li", null, h("span", { class: "swatch", style: `background:#${c.color}` }), c.label)),
      ),
      shown.length < ds.classes.length ? h("p", { class: "legend-note" }, "代表的な分類のみ表示しています。地図をクリックすると、その地点の分類名がわかります。") : null,
    );
    return;
  }
  const cm = displayColorMap(ds)!;
  const je = await loadJe();
  const colorMap = new je.image.ColorMap(toColorMapObject({ ...cm, deleteMin: false, deleteMax: false }));
  const bar = colorMap.createColorBarCanvas(opts.compact ? 200 : 260, 14);
  bar.classList.add("legend-bar");
  bar.setAttribute("role", "img");
  const off = ds.displayOffset ?? 0;
  const tv = ticks(cm.min, cm.max, cm.log);
  const span = cm.log ? Math.log10(cm.max) - Math.log10(cm.min) : cm.max - cm.min;
  const pos = (v: number) => (cm.log ? (Math.log10(v) - Math.log10(cm.min)) / span : (v - cm.min) / span) * 100;
  bar.setAttribute("aria-label", `カラースケール：${formatNumber(cm.min + off)}${ds.unitLabel}（${colorDesc(true)}）から ${formatNumber(cm.max + off)}${ds.unitLabel}（${colorDesc(false)}）`);
  const notes: string[] = [];
  if (ds.transparentBelow != null) notes.push(`${formatNumber(ds.transparentBelow + off)}${ds.unitLabel} 未満は表示していません。`);
  notes.push("透明な部分はデータがない場所です（雲・観測範囲外など）。");
  if (cm.log) notes.push("対数目盛：目盛りが1つ進むごとに値が10倍になります。");
  setChildren(
    container,
    h("div", { class: "legend-title" }, `${ds.icon} ${ds.shortName}`, h("span", { class: "legend-unit" }, ` 単位: ${ds.unitLabel}`)),
    bar,
    h(
      "div",
      { class: "legend-ticks", "aria-hidden": "true" },
      tv.map((v) => h("span", { style: `left:${pos(v)}%` }, formatNumber(v + off))),
    ),
    opts.compact ? null : h("p", { class: "legend-note" }, notes.join(" ")),
  );
}

function colorDesc(low: boolean): string {
  return low ? "低い" : "高い";
}
