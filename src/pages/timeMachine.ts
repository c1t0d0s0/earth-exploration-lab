import type { Map as MlMap } from "maplibre-gl";
import { DATASETS, getDataset, TIME_MACHINE_PRESETS } from "../core/datasetRegistry";
import { clampDate, formatDateJa, parseDateKey, periodStartDate, toDateKey } from "../core/dates";
import { getAvailableRange, getDates, getRegionSummary, toDisplay, type RegionSummary } from "../core/jaxaClient";
import { formatNumber } from "../core/stats";
import type { DatasetDef, TimeMachinePreset } from "../core/types";
import { LayerManager } from "../map/layerManager";
import { createMap, syncMaps, whenStyleLoaded } from "../map/mapView";
import { h, hashQuery, replaceHashQuery, setChildren } from "../ui/dom";
import { renderLegend } from "../ui/legend";
import { mapStatus } from "../ui/mapStatus";
import { dateInput } from "../ui/periodPicker";
import { TimeControl } from "../ui/timeControl";
import type { Page } from "./page";

type Mode = "swipe" | "side" | "anime";
type Bbox = [number, number, number, number];

export const timeMachinePage: Page = {
  title: "地球タイムマシン",
  mount(root) {
    const q = hashQuery();
    let preset: TimeMachinePreset | null = TIME_MACHINE_PRESETS.find((p) => p.id === q.get("preset")) ?? (q.get("ds") ? null : TIME_MACHINE_PRESETS[0]);
    let ds: DatasetDef = getDataset(preset?.dataset ?? q.get("ds")) ?? DATASETS[0];
    let dateA = preset ? parseDateKey(preset.dateA) : safe(q.get("a"));
    let dateB = preset ? parseDateKey(preset.dateB) : safe(q.get("b"));
    let mode: Mode = "swipe";
    let swipePos = 50;
    let disposed = false;
    let token = 0;

    // ---------------------------------------------------------------- layout
    const presetList = h("div", { class: "preset-list", role: "list" });
    const controls = h("div", { class: "map-toolbar" });
    const elA = h("div", { class: "map tm-map tm-a" });
    const elB = h("div", { class: "map tm-map tm-b" });
    const labelA = h("div", { class: "tm-label tm-label-a" }, "A");
    const labelB = h("div", { class: "tm-label tm-label-b" }, "B");
    const swipe = h("input", {
      type: "range", min: "0", max: "100", value: "50", class: "tm-swipe", "aria-label": "比較の境目の位置（左がA、右がB）",
      oninput: () => {
        swipePos = Number(swipe.value);
        applyMode();
      },
    });
    const compare = h("div", { class: "tm-compare", "data-mode": mode }, h("div", { class: "tm-pane tm-pane-a" }, elA, labelA), h("div", { class: "tm-pane tm-pane-b" }, elB, labelB), swipe);
    const timeControl = new TimeControl({
      label: "アニメーションの日時",
      onChange: async (d) => {
        labelA.textContent = formatDateJa(d, ds.temporal);
        await layersA?.setDate("tm", toDateKey(d, ds.temporal));
      },
    });
    const animeBar = h("div", { class: "map-bottom", hidden: true }, timeControl.el);
    const legendEl = h("div", null);
    const explainEl = h("div", { class: "tm-explain" });
    const summaryEl = h("div", { class: "tm-summary", "aria-live": "polite" });
    let layersA: LayerManager | null = null;
    let layersB: LayerManager | null = null;
    const status = mapStatus(() => (layersA?.reload(), layersB?.reload()));

    setChildren(
      root,
      h(
        "div",
        { class: "page-map page-tm" },
        h("aside", { class: "panel panel-left" }, h("h2", { class: "panel-heading" }, "変化を見てみよう"), presetList),
        h("div", { class: "map-area" }, controls, h("div", { class: "map-wrap" }, compare, status.el), animeBar),
        h("aside", { class: "panel panel-right" }, h("section", { class: "card" }, legendEl), h("section", { class: "card" }, explainEl, summaryEl)),
      ),
    );

    // ---------------------------------------------------------------- maps
    const mapA: MlMap = createMap(elA, { controls: true });
    const mapB: MlMap = createMap(elB, { controls: false });
    const unsync = syncMaps(mapA, mapB);

    function applyMode() {
      compare.dataset.mode = mode;
      const paneB = compare.querySelector<HTMLElement>(".tm-pane-b")!;
      paneB.style.clipPath = mode === "swipe" ? `inset(0 0 0 ${swipePos}%)` : "";
      compare.style.setProperty("--swipe", `${swipePos}%`);
      swipe.hidden = mode !== "swipe";
      animeBar.hidden = mode !== "anime";
      requestAnimationFrame(() => {
        mapA.resize();
        mapB.resize();
      });
    }

    // ---------------------------------------------------------------- presets
    function renderPresets() {
      setChildren(
        presetList,
        TIME_MACHINE_PRESETS.map((p) =>
          h(
            "button",
            { type: "button", role: "listitem", class: "preset-card", "aria-pressed": String(preset?.id === p.id), onclick: () => void loadPreset(p) },
            h("span", { class: "preset-icon", "aria-hidden": "true" }, p.icon),
            h("span", { class: "preset-title" }, p.title),
            h("span", { class: "preset-sub" }, `${getDataset(p.dataset)?.shortName ?? ""}・${p.dateA} と ${p.dateB}`),
          ),
        ),
        h("p", { class: "hint" }, "または、上のメニューでデータと2つの時点を自由に選べます。"),
      );
    }

    async function loadPreset(p: TimeMachinePreset) {
      preset = p;
      ds = getDataset(p.dataset)!;
      dateA = parseDateKey(p.dateA);
      dateB = parseDateKey(p.dateB);
      renderPresets();
      if (p.center) mapA.jumpTo({ center: p.center, zoom: p.zoom ?? 2 });
      else mapA.fitBounds(p.bbox, { padding: 30, duration: 0 });
      await refresh();
    }

    // ---------------------------------------------------------------- controls
    function renderControls(first: Date, last: Date) {
      const dsSelect = h(
        "select",
        {
          class: "input", "aria-label": "データセット",
          onchange: () => {
            ds = getDataset(dsSelect.value)!;
            preset = null;
            renderPresets();
            void refresh();
          },
        },
        DATASETS.map((d) => h("option", { value: d.key, selected: d.key === ds.key }, `${d.icon} ${d.shortName}`)),
      );
      const inA = dateInput(ds.temporal, dateA!, first, last, "時点A", (d) => ((dateA = d), void refresh(false)));
      const inB = dateInput(ds.temporal, dateB!, first, last, "時点B", (d) => ((dateB = d), void refresh(false)));
      const modeBtns = h(
        "div",
        { class: "segmented", role: "radiogroup", "aria-label": "表示方法" },
        ([["swipe", "スワイプ"], ["side", "並べて"], ["anime", "アニメ"]] as [Mode, string][]).map(([m, label]) =>
          h("button", {
            type: "button", role: "radio", "aria-checked": String(mode === m),
            onclick: (e: Event) => {
              mode = m;
              modeBtns.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b === e.currentTarget)));
              applyMode();
              if (m === "anime") void setupAnime();
              else {
                timeControl.stop();
                // アニメで動かした地図Aを時点Aに戻す
                if (dateA) {
                  labelA.textContent = `A: ${formatDateJa(dateA, ds.temporal)}`;
                  void layersA?.setDate("tm", toDateKey(dateA, ds.temporal));
                }
              }
            },
          }, label),
        ),
      );
      setChildren(
        controls,
        h("label", { class: "field-inline" }, h("span", { class: "field-label" }, "データ"), dsSelect),
        h("label", { class: "field-inline" }, h("span", { class: "field-label tag-a" }, "A"), inA),
        h("label", { class: "field-inline" }, h("span", { class: "field-label tag-b" }, "B"), inB),
        modeBtns,
      );
    }

    async function setupAnime() {
      if (!dateA || !dateB) return;
      const [s, e] = dateA < dateB ? [dateA, dateB] : [dateB, dateA];
      let dates = await getDates(ds, s, e);
      // 日別データは同じ日付の年ごと、または間引いて表示
      if (ds.temporal === "daily" && dates.length > 60) {
        const md = toDateKey(s, "daily").slice(5);
        const sameDay = dates.filter((d) => toDateKey(d, "daily").slice(5) === md);
        dates = sameDay.length >= 2 ? sameDay : dates.filter((_, i) => i % Math.ceil(dates.length / 60) === 0);
      }
      timeControl.setDates(dates, ds.temporal, s);
      const cur = timeControl.current();
      if (cur) {
        labelA.textContent = formatDateJa(cur, ds.temporal);
        await layersA?.setDate("tm", toDateKey(cur, ds.temporal));
      }
    }

    // ---------------------------------------------------------------- refresh
    async function refresh(resetControls = true) {
      const t = ++token;
      timeControl.stop();
      try {
        const { first: f0, last } = await getAvailableRange(ds);
        if (disposed || t !== token) return;
        const first = f0 < periodStartDate(ds) ? periodStartDate(ds) : f0;
        dateA = clampDate(dateA ?? first, first, last);
        dateB = clampDate(dateB ?? last, first, last);
        if (resetControls) renderControls(first, last);
        replaceHashQuery({ preset: preset?.id, ds: preset ? null : ds.key, a: preset ? null : toDateKey(dateA, ds.temporal), b: preset ? null : toDateKey(dateB, ds.temporal) });
        labelA.textContent = `A: ${formatDateJa(dateA, ds.temporal)}`;
        labelB.textContent = `B: ${formatDateJa(dateB, ds.temporal)}`;
        for (const [lm, d] of [[layersA, dateA], [layersB, dateB]] as const) {
          if (!lm) continue;
          lm.clear();
          lm.add({ id: "tm", datasetKey: ds.key, dateKey: toDateKey(d, ds.temporal), opacity: 0.9, visible: true });
        }
        void renderLegend(legendEl, ds, { compact: true });
        renderExplain();
        if (mode === "anime") void setupAnime();
        void computeSummary(t, preset?.bbox ?? viewBbox());
      } catch (e) {
        setChildren(controls, h("p", { class: "error", role: "alert" }, `データを読み込めませんでした：${(e as Error).message}`));
      }
    }

    function viewBbox(): Bbox {
      const b = mapA.getBounds();
      return [Math.max(-180, b.getWest()), Math.max(-85, b.getSouth()), Math.min(180, b.getEast()), Math.min(85, b.getNorth())];
    }

    function renderExplain() {
      const p = preset;
      setChildren(
        explainEl,
        p
          ? [
              h("h2", { class: "panel-title" }, `${p.icon} ${p.title}`),
              h("p", { class: "question" }, "❓ ", p.question),
              h("details", { class: "reveal" }, h("summary", null, "観察したら、こたえを見る"), h("p", null, p.simple), h("p", { class: "detail" }, p.detail)),
            ]
          : [h("h2", { class: "panel-title" }, `${ds.icon} ${ds.name}`), h("p", null, "AとBの2つの時点をくらべて、どこが変わったか探してみよう。")],
        h(
          "div",
          { class: "caution-box" },
          h("strong", null, "くらべるときの注意"),
          h(
            "ul",
            null,
            p ? h("li", null, p.caution) : null,
            h("li", null, ds.caution),
            h("li", null, "2つの時点では、雲の量・季節・観測条件がちがうことがあります。変化のすべてが本当の変化とは限りません。"),
            ds.temporal === "monthly" ? h("li", null, "季節による変化と区別するため、長い期間をくらべるときは同じ月どうしで比べましょう。") : null,
          ),
        ),
      );
    }

    async function computeSummary(t: number, bbox: Bbox) {
      if (!dateA || !dateB) return;
      setChildren(summaryEl, h("p", { class: "hint" }, "選んだ範囲の変化を計算中…"));
      try {
        const [a, b] = await Promise.all([getRegionSummary(ds, dateA, bbox), getRegionSummary(ds, dateB, bbox)]);
        if (disposed || t !== token) return;
        setChildren(
          summaryEl,
          h("h3", null, "範囲の数値でくらべる"),
          ds.valueKind === "classified" ? classTable(ds, a, b) : meanTable(ds, a, b),
          h("p", { class: "hint" }, `範囲: 経度 ${bbox[0].toFixed(1)}〜${bbox[2].toFixed(1)}、緯度 ${bbox[1].toFixed(1)}〜${bbox[3].toFixed(1)}（約96×96点の単純平均。面積の重みや欠損は考慮していません）`),
          h("button", { type: "button", class: "btn btn-sm", onclick: () => void computeSummary(token, viewBbox()) }, "いま見ている範囲で計算しなおす"),
        );
      } catch (e) {
        if (t === token) setChildren(summaryEl, h("p", { class: "error" }, `数値を計算できませんでした：${(e as Error).message}`));
      }
    }

    // ---------------------------------------------------------------- init
    renderPresets();
    applyMode();
    void Promise.all([whenStyleLoaded(mapA), whenStyleLoaded(mapB)]).then(async () => {
      if (disposed) return;
      layersA = new LayerManager(mapA);
      layersB = new LayerManager(mapB);
      if (preset) await loadPreset(preset);
      else await refresh();
    });

    return () => {
      disposed = true;
      timeControl.stop();
      unsync();
      status.destroy();
      mapA.remove();
      mapB.remove();
    };
  },
};

function meanTable(ds: DatasetDef, a: RegionSummary, b: RegionSummary) {
  const va = toDisplay(ds, a.mean);
  const vb = toDisplay(ds, b.mean);
  const diff = va != null && vb != null ? vb - va : null;
  const word = diff == null ? "" : Math.abs(diff) < 1e-9 ? "ほとんど変わっていません" : diff > 0 ? "増えています ⬆️" : "減っています ⬇️";
  return h(
    "div",
    null,
    h(
      "table",
      { class: "meta-table" },
      h("tbody", null,
        h("tr", null, h("th", { scope: "row" }, `A ${formatDateJa(a.date, ds.temporal)}`), h("td", null, `${formatNumber(va)} ${ds.unitLabel}`), h("td", { class: "muted" }, `有効 ${Math.round(a.validRatio * 100)}%`)),
        h("tr", null, h("th", { scope: "row" }, `B ${formatDateJa(b.date, ds.temporal)}`), h("td", null, `${formatNumber(vb)} ${ds.unitLabel}`), h("td", { class: "muted" }, `有効 ${Math.round(b.validRatio * 100)}%`)),
        h("tr", null, h("th", { scope: "row" }, "変化 (B−A)"), h("td", { colspan: "2" }, diff == null ? "—" : `${diff > 0 ? "+" : ""}${formatNumber(diff)} ${ds.unitLabel}`)),
      ),
    ),
    word ? h("p", null, `範囲の平均は ${word}`) : null,
    Math.abs(a.validRatio - b.validRatio) > 0.15 ? h("p", { class: "caution" }, "⚠️ AとBでデータのある点の割合が大きくちがいます（雲など）。平均値の比較には注意しましょう。") : null,
  );
}

function classTable(ds: DatasetDef, a: RegionSummary, b: RegionSummary) {
  const keys = [...new Set([...(a.classShares?.keys() ?? []), ...(b.classShares?.keys() ?? [])])]
    .map((k) => ({ k, sa: a.classShares?.get(k) ?? 0, sb: b.classShares?.get(k) ?? 0 }))
    .filter((r) => r.sa >= 0.01 || r.sb >= 0.01)
    .sort((x, y) => y.sa + y.sb - (x.sa + x.sb))
    .slice(0, 8);
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return h(
    "table",
    { class: "meta-table" },
    h("thead", null, h("tr", null, h("th", { scope: "col" }, "分類"), h("th", { scope: "col" }, formatDateJa(a.date, ds.temporal)), h("th", { scope: "col" }, formatDateJa(b.date, ds.temporal)), h("th", { scope: "col" }, "変化"))),
    h(
      "tbody",
      null,
      keys.map(({ k, sa, sb }) => {
        const c = ds.classes?.find((x) => x.value === k);
        return h("tr", null,
          h("th", { scope: "row" }, h("span", { class: "swatch", style: `background:#${c?.color ?? "888"}` }), c?.label ?? `分類 ${k}`),
          h("td", null, pct(sa)), h("td", null, pct(sb)),
          h("td", null, `${sb - sa >= 0 ? "+" : ""}${((sb - sa) * 100).toFixed(1)}pt`));
      }),
    ),
  );
}

function safe(s: string | null): Date | undefined {
  if (!s) return undefined;
  try {
    return parseDateKey(s);
  } catch {
    return undefined;
  }
}
