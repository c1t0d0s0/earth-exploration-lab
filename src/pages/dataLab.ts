import { Marker, type Map as MlMap } from "maplibre-gl";
import { DATASETS, getDataset, LAB_PRESETS, supportsPoint, supportsSeries } from "../core/datasetRegistry";
import { addMonths, formatDateJa, parseDateKey, toDateKey } from "../core/dates";
import { getAvailableRange, getPointValue, toDisplay } from "../core/jaxaClient";
import { alignByKey, describeCorrelation, pearson } from "../core/stats";
import { fetchPointSeries, type SeriesPoint } from "../core/timeSeries";
import type { DatasetDef, LabPreset } from "../core/types";
import { LayerManager } from "../map/layerManager";
import { createMap, whenStyleLoaded } from "../map/mapView";
import { h, hashQuery, replaceHashQuery, setChildren } from "../ui/dom";
import { scatterPlot, timeSeriesChart } from "../ui/chart";
import { renderLegend } from "../ui/legend";
import { mapStatus } from "../ui/mapStatus";
import { dateInput, periodPicker } from "../ui/periodPicker";
import { formatLngLat, formatValue, wrapLng } from "../ui/pointValue";
import type { Page } from "./page";

const MAX_LAYERS = 3;
const MAX_POINTS = 6;
const SERIES_COLORS = ["#38bdf8", "#f59e0b", "#a78bfa"];

interface LabLayer {
  id: string;
  ds: DatasetDef;
  opacity: number;
  visible: boolean;
}

interface LabPoint {
  id: number;
  name: string;
  lng: number;
  lat: number;
  marker: Marker;
}

export const dataLabPage: Page = {
  title: "地球データ実験室",
  mount(root) {
    let layers: LabLayer[] = [];
    let points: LabPoint[] = [];
    let selected: number | null = null;
    let pointSeq = 0;
    let current = addMonths(firstOfMonth(new Date()), -2);
    let period = { start: addMonths(current, -35), end: current };
    let lm: LayerManager | null = null;
    let disposed = false;
    let analysisAbort: AbortController | null = null;
    let chartDestroy: (() => void) | null = null;
    let valuesToken = 0;

    // ---------------------------------------------------------------- layout
    const mapEl = h("div", { class: "map" });
    const presetEl = h("div", { class: "lab-presets" });
    const layersEl = h("div", { class: "lab-layers" });
    const dateEl = h("div", { class: "lab-dates" });
    const legendsEl = h("div", { class: "lab-legends" });
    const pointsEl = h("div", { class: "lab-points", "aria-live": "polite" });
    const analysisEl = h("div", { class: "lab-analysis" });
    const status = mapStatus(() => lm?.reload());
    setChildren(
      root,
      h(
        "div",
        { class: "page-lab" },
        h("div", { class: "lab-map" }, h("div", { class: "map-wrap" }, mapEl, status.el, legendsEl)),
        h(
          "div",
          { class: "lab-panel" },
          h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "🔬 探究テーマをえらぶ"), presetEl),
          h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "① データレイヤー"), layersEl, dateEl),
          h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "② 地点をえらぶ"), pointsEl),
          h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "③ グラフで分析"), analysisEl),
        ),
      ),
    );

    const map: MlMap = createMap(mapEl, { center: [135, 20], zoom: 1.4 });

    // ---------------------------------------------------------------- presets
    function renderPresets() {
      setChildren(
        presetEl,
        h(
          "div",
          { class: "chip-list" },
          LAB_PRESETS.map((p) => {
            const a = getDataset(p.a)!;
            const b = getDataset(p.b)!;
            return h("button", { type: "button", class: "chip", onclick: () => void applyPreset(p) }, `${a.icon}${b.icon} ${p.question}`);
          }),
        ),
      );
    }

    async function applyPreset(p: LabPreset) {
      replaceHashQuery({ preset: p.id });
      for (const l of layers) lm?.remove(l.id);
      layers = [];
      for (const pt of points) pt.marker.remove();
      points = [];
      selected = null;
      addLayer(getDataset(p.a)!, 0.85);
      addLayer(getDataset(p.b)!, 0.6);
      addPoint(p.point[0], p.point[1], p.pointName);
      for (const [lng, lat, name] of p.extraPoints ?? []) addPoint(lng, lat, name);
      selected = points[0]?.id ?? null;
      map.flyTo({ center: p.point, zoom: p.id === "lst-landcover" ? 8 : 3 });
      await refreshAll();
      renderAnalysis(p.question);
    }

    // ---------------------------------------------------------------- layers
    function addLayer(ds: DatasetDef, opacity = 0.7) {
      if (layers.length >= MAX_LAYERS) return;
      const id = `lab${Date.now().toString(36)}${layers.length}`;
      const l: LabLayer = { id, ds, opacity, visible: true };
      layers.push(l);
      lm?.add({ id, datasetKey: ds.key, dateKey: toDateKey(current, ds.temporal), opacity, visible: true });
      lm?.setOrder(layers.map((x) => x.id));
    }

    function renderLayers() {
      const addSelect = h(
        "select",
        { class: "input", "aria-label": "追加するデータ" },
        DATASETS.filter((d) => !layers.some((l) => l.ds.key === d.key)).map((d) => h("option", { value: d.key }, `${d.icon} ${d.shortName}`)),
      );
      setChildren(
        layersEl,
        layers.length ? null : h("p", { class: "hint" }, "データを追加するか、上の探究テーマをえらんでください。"),
        h(
          "ol",
          { class: "layer-list" },
          layers.map((l, i) =>
            h(
              "li",
              { class: "layer-item" },
              h("span", { class: "layer-color", style: `background:${SERIES_COLORS[i]}`, "aria-hidden": "true" }),
              h("span", { class: "layer-name" }, `${l.ds.icon} ${l.ds.shortName}`, i === 0 ? h("small", null, "（いちばん上）") : null),
              h("label", { class: "check" }, h("input", {
                type: "checkbox", checked: l.visible, "aria-label": `${l.ds.shortName}を表示`,
                onchange: (e: Event) => {
                  l.visible = (e.target as HTMLInputElement).checked;
                  lm?.setVisible(l.id, l.visible);
                },
              }), "表示"),
              h("input", {
                type: "range", min: "0", max: "1", step: "0.05", value: String(l.opacity), class: "layer-opacity", "aria-label": `${l.ds.shortName}の不透明度`,
                oninput: (e: Event) => {
                  l.opacity = Number((e.target as HTMLInputElement).value);
                  lm?.setOpacity(l.id, l.opacity);
                },
              }),
              h("span", { class: "layer-actions" },
                h("button", { type: "button", class: "btn btn-icon", "aria-label": `${l.ds.shortName}を上へ`, disabled: i === 0, onclick: () => move(i, -1) }, "↑"),
                h("button", { type: "button", class: "btn btn-icon", "aria-label": `${l.ds.shortName}を下へ`, disabled: i === layers.length - 1, onclick: () => move(i, 1) }, "↓"),
                h("button", { type: "button", class: "btn btn-icon", "aria-label": `${l.ds.shortName}を削除`, onclick: () => removeLayer(l.id) }, "✕"),
              ),
            ),
          ),
        ),
        h(
          "div",
          { class: "row" },
          addSelect,
          h("button", {
            type: "button", class: "btn", disabled: layers.length >= MAX_LAYERS,
            onclick: () => {
              const ds = getDataset(addSelect.value);
              if (ds) {
                addLayer(ds);
                void refreshAll();
              }
            },
          }, "＋ 追加"),
        ),
        layers.length >= MAX_LAYERS ? h("p", { class: "hint" }, `同時に表示できるのは${MAX_LAYERS}つまでです。`) : null,
      );
    }

    function move(i: number, d: number) {
      const j = i + d;
      [layers[i], layers[j]] = [layers[j], layers[i]];
      lm?.setOrder(layers.map((x) => x.id));
      void refreshAll();
    }

    function removeLayer(id: string) {
      lm?.remove(id);
      layers = layers.filter((l) => l.id !== id);
      void refreshAll();
    }

    // ---------------------------------------------------------------- dates
    async function renderDates() {
      const min = new Date(Date.UTC(2000, 2, 1));
      // 表示中のデータの最新日時のうち、もっとも早いものを上限にする（全データがそろう時点）
      let max = firstOfMonth(new Date());
      for (const l of layers) {
        if (l.ds.temporal !== "monthly") continue;
        try {
          const r = await getAvailableRange(l.ds);
          if (r.last < max) max = r.last;
        } catch {
          /* 取得失敗時は既定値 */
        }
      }
      if (current > max) current = max;
      if (period.end > max) period = { start: addMonths(max, -35), end: max };
      const pp = periodPicker("monthly", period.start, period.end, min, max, (s, e) => {
        period = { start: s, end: e };
        renderAnalysis();
      });
      setChildren(
        dateEl,
        h("div", { class: "row" },
          h("label", { class: "field-inline" }, h("span", { class: "field-label" }, "地図の日時"),
            dateInput("monthly", current, min, max, "地図に表示する年月", (d) => {
              current = d;
              void syncLayerDates();
              void renderPointValues();
            })),
        ),
        h("div", { class: "row" }, pp.el),
        h("p", { class: "hint" }, "年別・日別のデータは、指定した年月にもっとも近い過去のデータを表示します。グラフはこの期間で作ります。"),
      );
    }

    async function syncLayerDates() {
      await Promise.all(layers.map((l) => lm?.setDate(l.id, toDateKey(current, l.ds.temporal))));
    }

    // ---------------------------------------------------------------- legends
    function renderLegends() {
      setChildren(legendsEl, layers.map((l) => {
        const el = h("div", { class: "legend-mini" });
        void renderLegend(el, l.ds, { compact: true });
        return el;
      }));
    }

    // ---------------------------------------------------------------- points
    function addPoint(lng: number, lat: number, name?: string) {
      if (points.length >= MAX_POINTS) {
        const old = points.shift()!;
        old.marker.remove();
      }
      const id = ++pointSeq;
      const el = h("div", { class: "pt-marker", "aria-hidden": "true" }, String(id));
      const marker = new Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        selectPoint(id);
      });
      points.push({ id, name: name ?? `地点${id}`, lng, lat, marker });
      selected = id;
    }

    function selectPoint(id: number) {
      selected = id;
      void renderPointValues();
      renderAnalysis();
    }

    async function renderPointValues() {
      const t = ++valuesToken;
      for (const p of points) p.marker.getElement().classList.toggle("selected", p.id === selected);
      if (!points.length) {
        setChildren(pointsEl, h("p", { class: "hint" }, "👆 地図をクリック（タップ）すると、その地点のデータの値を調べられます。都市と森林など、いくつかの地点をくらべてみよう。"));
        return;
      }
      const cell = (p: LabPoint, l: LabLayer) => {
        const td = h("td", null, "…");
        if (!supportsPoint(l.ds)) {
          td.textContent = "対応なし";
          return td;
        }
        getPointValue(l.ds, current, p.lng, p.lat)
          .then((pv) => t === valuesToken && (td.textContent = formatValue(l.ds, pv.value)))
          .catch(() => t === valuesToken && (td.textContent = "取得失敗"));
        return td;
      };
      setChildren(
        pointsEl,
        h("p", { class: "hint" }, `${formatDateJa(current, "monthly")}の値（行をえらぶとグラフに表示）`),
        h(
          "div",
          { class: "table-scroll" },
          h(
            "table",
            { class: "values-table" },
            h("thead", null, h("tr", null, h("th", { scope: "col" }, "地点"), layers.map((l, i) => h("th", { scope: "col", style: `border-bottom-color:${SERIES_COLORS[i]}` }, l.ds.shortName)), h("th", null, h("span", { class: "sr-only" }, "操作")))),
            h(
              "tbody",
              null,
              points.map((p) =>
                h(
                  "tr",
                  { class: p.id === selected ? "selected" : "", "aria-selected": String(p.id === selected) },
                  h("th", { scope: "row" },
                    h("button", { type: "button", class: "link-btn", onclick: () => selectPoint(p.id) }, `${p.id}. ${p.name}`),
                    h("small", null, formatLngLat(p.lng, p.lat))),
                  layers.map((l) => cell(p, l)),
                  h("td", null, h("button", {
                    type: "button", class: "btn btn-icon", "aria-label": `${p.name}を削除`,
                    onclick: () => {
                      p.marker.remove();
                      points = points.filter((x) => x.id !== p.id);
                      if (selected === p.id) selected = points[0]?.id ?? null;
                      void renderPointValues();
                      renderAnalysis();
                    },
                  }, "✕")),
                ),
              ),
            ),
          ),
        ),
      );
    }

    // ---------------------------------------------------------------- analysis
    function renderAnalysis(question?: string) {
      analysisAbort?.abort();
      chartDestroy?.();
      chartDestroy = null;
      const pt = points.find((p) => p.id === selected);
      const seriesLayers = layers.filter((l) => supportsSeries(l.ds)).slice(0, 2);
      const causation = h(
        "div",
        { class: "caution-box" },
        h("strong", null, "⚠️ 「相関」と「原因」はちがいます"),
        h("p", null, "2つのデータが一緒に増えたり減ったりしても、一方がもう一方の原因だとは限りません。どちらも「季節」や「緯度」など、別の理由（第三の要因）で変わっているだけかもしれません。"),
        h("p", null, "仮説を確かめるには、ほかの地点や期間でも同じ関係が見られるか、しくみとして説明できるかを調べてみよう。"),
      );
      if (!pt || !seriesLayers.length) {
        const notes: (string | Node)[] = [];
        if (!pt) notes.push("地点をえらぶと、その地点の時系列グラフを表示します。");
        const cls = layers.filter((l) => !supportsSeries(l.ds));
        if (cls.length) notes.push(`${cls.map((l) => l.ds.shortName).join("・")} は分類データ・年別データ等のため時系列グラフには使えません。②の表で地点ごとに比べてみよう。`);
        setChildren(analysisEl, question ? h("p", { class: "question" }, "❓ ", question) : null, notes.map((n) => h("p", { class: "hint" }, n)), causation);
        return;
      }
      const progress = h("p", { class: "hint", role: "status" }, "データを取得中…");
      const chartBox = h("div", null);
      const corrBox = h("div", null);
      const unsupported = layers.filter((l) => !supportsSeries(l.ds));
      setChildren(
        analysisEl,
        question ? h("p", { class: "question" }, "❓ ", question) : null,
        h("p", null, `📍 ${pt.name}（${formatLngLat(pt.lng, pt.lat)}）の ${formatDateJa(period.start, "monthly")}〜${formatDateJa(period.end, "monthly")}`),
        unsupported.length ? h("p", { class: "hint" }, `${unsupported.map((l) => l.ds.shortName).join("・")} はグラフに対応していないため、②の表で比べてください。`) : null,
        progress,
        chartBox,
        corrBox,
        causation,
      );
      const ac = new AbortController();
      analysisAbort = ac;
      const totals = new Map<string, [number, number]>();
      const results: SeriesPoint[][] = [];
      void Promise.all(
        seriesLayers.map((l, i) =>
          fetchPointSeries(l.ds, pt.lng, pt.lat, period.start, period.end, {
            signal: ac.signal,
            onProgress: (d, n) => {
              totals.set(l.id, [d, n]);
              const sum = [...totals.values()].reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
              progress.textContent = `データを取得中… ${sum[0]} / ${sum[1]}`;
            },
          }).then((s) => (results[i] = s)),
        ),
      )
        .then(() => {
          if (ac.signal.aborted || disposed) return;
          progress.textContent = "";
          const chart = timeSeriesChart(
            seriesLayers.map((l, i) => ({
              label: l.ds.shortName,
              unit: l.ds.unitLabel,
              color: SERIES_COLORS[layers.indexOf(l)],
              points: results[i].map((p) => ({ t: p.date.getTime(), v: toDisplay(l.ds, p.value) })),
            })),
            { title: `${pt.name}の時系列グラフ` },
          );
          chartBox.appendChild(chart.el);
          chartDestroy = chart.destroy;
          const missing = results.map((r, i) => ({ name: seriesLayers[i].ds.shortName, n: r.filter((p) => p.value == null).length, total: r.length }));
          for (const m of missing) if (m.n) chartBox.appendChild(h("p", { class: "hint" }, `${m.name}: ${m.total}件中${m.n}件は欠損（雲・観測範囲外など）のため表示していません。`));
          if (seriesLayers.length === 2) renderCorrelation(corrBox, seriesLayers, results);
        })
        .catch((e) => {
          if ((e as Error).name === "AbortError") return;
          progress.textContent = `データを取得できませんでした：${(e as Error).message}`;
        });
    }

    function renderCorrelation(box: HTMLElement, ls: LabLayer[], results: SeriesPoint[][]) {
      const [la, lb] = ls;
      const disp = (l: LabLayer, s: SeriesPoint[]) => s.map((p) => ({ key: p.key.slice(0, 7), value: toDisplay(l.ds, p.value) }));
      const { keys, xs, ys } = alignByKey(disp(la, results[0]), disp(lb, results[1]));
      const corr = pearson(xs, ys);
      const ia = layers.indexOf(la);
      const ib = layers.indexOf(lb);
      setChildren(
        box,
        h("h3", null, "2つのデータの関係（散布図）"),
        scatterPlot(xs, ys, keys, { x: `${la.ds.shortName}（${la.ds.unitLabel}）`, y: `${lb.ds.shortName}（${lb.ds.unitLabel}）`, xColor: SERIES_COLORS[ia], yColor: SERIES_COLORS[ib] }, corr),
        corr
          ? h(
              "div",
              { class: "corr-result" },
              h("p", { class: "corr-value" }, "相関係数 r = ", h("strong", null, corr.r.toFixed(2)), `（${corr.n}か月分）`, " → ", h("strong", null, describeCorrelation(corr.r).label)),
              h("p", null, describeCorrelation(corr.r).plain),
              h("details", null, h("summary", null, "相関係数とは？"), h("p", null, "相関係数 r は −1 から 1 の値で、2つのデータがどれくらい一緒に変化するかを表します。1 に近いほど「一方が増えるともう一方も増える」、−1 に近いほど「一方が増えるともう一方は減る」、0 に近いほど関係がはっきりしないことを表します。ここでは同じ月どうしの値を組にして計算しています（ピアソンの積率相関係数）。")),
            )
          : h("p", { class: "hint" }, "両方のデータがそろった月が3か月未満のため、相関係数を計算できません。期間を長くするか、別の地点をえらんでみよう。"),
      );
    }

    // ---------------------------------------------------------------- refresh
    async function refreshAll() {
      renderLayers();
      renderLegends();
      await renderDates();
      await syncLayerDates();
      void renderPointValues();
      renderAnalysis();
    }

    map.on("click", (e) => {
      addPoint(wrapLng(e.lngLat.lng), e.lngLat.lat);
      void renderPointValues();
      renderAnalysis();
    });

    renderPresets();
    void renderPointValues();
    renderAnalysis();
    void whenStyleLoaded(map).then(async () => {
      if (disposed) return;
      lm = new LayerManager(map);
      const pr = LAB_PRESETS.find((p) => p.id === hashQuery().get("preset"));
      if (pr) await applyPreset(pr);
      else {
        addLayer(getDataset("precip")!, 0.85);
        await refreshAll();
      }
    });

    return () => {
      disposed = true;
      analysisAbort?.abort();
      chartDestroy?.();
      status.destroy();
      map.remove();
    };
  },
};

function firstOfMonth(d: Date): Date {
  return parseDateKey(toDateKey(d, "monthly"));
}
