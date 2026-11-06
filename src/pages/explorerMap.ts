import { Popup, type Map as MlMap } from "maplibre-gl";
import { DATASETS, datasetsByCategory, getDataset } from "../core/datasetRegistry";
import { clampDate, defaultRange, formatDateJa, parseDateKey, periodStartDate, toDateKey } from "../core/dates";
import { getAvailableRange, getDates } from "../core/jaxaClient";
import { CATEGORY_LABELS, type DatasetDef } from "../core/types";
import { LayerManager } from "../map/layerManager";
import { createMap, whenStyleLoaded } from "../map/mapView";
import { h, hashQuery, replaceHashQuery, setChildren } from "../ui/dom";
import { renderInfoPanel } from "../ui/infoPanel";
import { renderLegend } from "../ui/legend";
import { mapStatus } from "../ui/mapStatus";
import { dateInput, periodPicker } from "../ui/periodPicker";
import { describePoint, formatLngLat, wrapLng } from "../ui/pointValue";
import { TimeControl } from "../ui/timeControl";
import type { Page } from "./page";

const LAYER = "main";

export const explorerMapPage: Page = {
  title: "地球探検マップ",
  mount(root) {
    const q = hashQuery();
    let ds: DatasetDef = getDataset(q.get("ds")) ?? DATASETS[0];
    let current: Date | undefined = q.get("date") ? safeDate(q.get("date")!) : undefined;
    let opacity = 0.85;
    let disposed = false;
    let selectToken = 0;

    // ---------------------------------------------------------------- layout
    const datasetList = h("nav", { class: "dataset-list", "aria-label": "データセットの選択" });
    const left = h("aside", { class: "panel panel-left" }, h("h2", { class: "panel-heading" }, "データをえらぶ"), datasetList);
    const topBar = h("div", { class: "map-toolbar" });
    const mapEl = h("div", { class: "map" });
    const legendEl = h("div", null);
    const infoEl = h("div", { class: "info" });
    const opacityInput = h("input", {
      type: "range", min: "0", max: "1", step: "0.05", value: String(opacity), "aria-label": "データの透明度",
      oninput: () => {
        opacity = Number(opacityInput.value);
        layers?.setOpacity(LAYER, opacity);
      },
    });
    const right = h(
      "aside",
      { class: "panel panel-right" },
      h("section", { class: "card" }, legendEl, h("label", { class: "field" }, h("span", { class: "field-label" }, "不透明度"), opacityInput)),
      h("section", { class: "card" }, infoEl),
    );
    const timeControl = new TimeControl({
      label: "表示する日時",
      onChange: async (d) => {
        current = d;
        syncDateInput();
        replaceHashQuery({ ds: ds.key, date: toDateKey(d, ds.temporal) });
        await layers?.setDate(LAYER, toDateKey(d, ds.temporal));
      },
    });
    let layers: LayerManager | null = null;
    const status = mapStatus(() => layers?.reload());
    const mapArea = h("div", { class: "map-area" }, topBar, h("div", { class: "map-wrap" }, mapEl, status.el), h("div", { class: "map-bottom" }, timeControl.el));
    setChildren(root, h("div", { class: "page-map" }, left, mapArea, right));

    // ---------------------------------------------------------------- dataset list
    function renderDatasetList() {
      const groups = datasetsByCategory();
      setChildren(
        datasetList,
        [...groups].map(([cat, list]) =>
          h(
            "div",
            { class: "dataset-group" },
            h("h3", null, CATEGORY_LABELS[cat]),
            list.map((d) =>
              h(
                "button",
                {
                  type: "button",
                  class: "dataset-btn",
                  "aria-pressed": String(d.key === ds.key),
                  onclick: () => {
                    if (d.key !== ds.key) void selectDataset(d);
                  },
                },
                h("span", { class: "ds-icon", "aria-hidden": "true" }, d.icon),
                h("span", { class: "ds-name" }, d.shortName),
                h("span", { class: "ds-meta" }, d.temporal === "monthly" ? "月" : d.temporal === "daily" ? "日" : "年"),
              ),
            ),
          ),
        ),
      );
    }

    // ---------------------------------------------------------------- top bar
    let dateInputEl: HTMLInputElement | null = null;
    function syncDateInput() {
      if (dateInputEl && current) dateInputEl.value = toDateKey(current, ds.temporal);
    }

    async function renderTopBar(first: Date, last: Date, range: { start: Date; end: Date }) {
      dateInputEl = dateInput(ds.temporal, current ?? last, first, last, "日時を指定", (d) => {
        // 指定日時が期間外なら、その日時を含むように期間を移動する
        const r = period.get();
        if (d < r.start || d > r.end) {
          const nr = defaultRange(ds, clampDate(d, first, last));
          void loadPeriod(nr.start, nr.end, d);
        } else {
          void goTo(d);
        }
      });
      const period = periodPicker(ds.temporal, range.start, range.end, first, last, (s, e) => void loadPeriod(s, e, current));
      setChildren(
        topBar,
        h("label", { class: "field-inline" }, h("span", { class: "field-label" }, "日時"), dateInputEl),
        period.el,
        h("span", { class: "toolbar-note" }, `最新: ${formatDateJa(last, ds.temporal)}`),
      );
    }

    async function goTo(d: Date) {
      const key = toDateKey(d, ds.temporal);
      const dates = timeDates;
      const i = dates.findIndex((x) => toDateKey(x, ds.temporal) === key);
      if (i >= 0) await timeControl.go(i);
      else {
        const before = dates.filter((x) => x <= d);
        await timeControl.go(before.length ? dates.indexOf(before[before.length - 1]) : 0);
      }
    }

    let timeDates: Date[] = [];
    async function loadPeriod(start: Date, end: Date, focus?: Date) {
      const token = selectToken;
      const dates = await getDates(ds, start, end);
      if (disposed || token !== selectToken) return;
      timeDates = dates;
      timeControl.setDates(dates, ds.temporal, focus ?? dates[dates.length - 1]);
      const cur = timeControl.current();
      if (cur) {
        current = cur;
        syncDateInput();
        replaceHashQuery({ ds: ds.key, date: toDateKey(cur, ds.temporal) });
        await layers?.setDate(LAYER, toDateKey(cur, ds.temporal));
      }
    }

    // ---------------------------------------------------------------- select dataset
    async function selectDataset(d: DatasetDef) {
      const token = ++selectToken;
      timeControl.stop();
      // 時間解像度がちがうデータへ切り替えたときは最新の日時から始める（年別→日別で「1月1日」になるのを防ぐ）
      if (d.temporal !== ds.temporal) current = undefined;
      ds = d;
      renderDatasetList();
      renderInfoPanel(infoEl, ds);
      void renderLegend(legendEl, ds).catch((e) => setChildren(legendEl, h("p", { class: "error" }, (e as Error).message)));
      setChildren(topBar, h("span", { class: "toolbar-note" }, "データの期間を確認中…"));
      try {
        const { first, last } = await getAvailableRange(ds);
        if (disposed || token !== selectToken) return;
        const focus = current ? clampDate(current, first, last) : last;
        const range = defaultRange(ds, focus);
        if (range.end < focus) range.end = focus;
        renderInfoPanel(infoEl, ds, { availableLast: toDateKey(last, ds.temporal) });
        await renderTopBar(first < periodStartDate(ds) ? periodStartDate(ds) : first, last, range);
        // レイヤーを入れ替え
        layers?.remove(LAYER);
        const dates = await getDates(ds, range.start, range.end);
        if (disposed || token !== selectToken) return;
        timeDates = dates;
        timeControl.setDates(dates, ds.temporal, focus);
        current = timeControl.current() ?? focus;
        syncDateInput();
        replaceHashQuery({ ds: ds.key, date: toDateKey(current, ds.temporal) });
        layers?.add({ id: LAYER, datasetKey: ds.key, dateKey: toDateKey(current, ds.temporal), opacity, visible: true });
        if (ds.key === "seaice" && map && map.getZoom() < 1.5) map.flyTo({ center: [0, 75], zoom: 1.6 });
      } catch (e) {
        if (token !== selectToken) return;
        setChildren(topBar, h("p", { class: "error", role: "alert" }, `データを読み込めませんでした：${(e as Error).message}`));
      }
    }

    // ---------------------------------------------------------------- map
    renderDatasetList();
    // c=経度,緯度,ズーム で地図の中心を指定できる（発見カードからのリンク用）
    const c = (q.get("c") ?? "").split(",").map(Number);
    const hasCenter = c.length >= 2 && c.every((v) => Number.isFinite(v)) && Math.abs(c[1]) <= 90;
    const map: MlMap = createMap(mapEl, hasCenter ? { center: [c[0], c[1]], zoom: c[2] ?? 4 } : { center: [135, 15], zoom: 1.3 });
    const popup = new Popup({ closeButton: true, maxWidth: "280px" });
    map.on("click", async (e) => {
      const lng = wrapLng(e.lngLat.lng);
      const lat = e.lngLat.lat;
      const d = current;
      if (!d) return;
      popup.setLngLat(e.lngLat).setText(`${formatLngLat(lng, lat)}\n読み込み中…`).addTo(map);
      const text = await describePoint(ds, d, lng, lat);
      if (popup.isOpen()) popup.setText(`${formatLngLat(lng, lat)}\n${text}`);
    });
    void whenStyleLoaded(map).then(() => {
      if (disposed) return;
      layers = new LayerManager(map);
      void selectDataset(ds);
    });

    return () => {
      disposed = true;
      timeControl.stop();
      status.destroy();
      popup.remove();
      map.remove();
    };
  },
};

function safeDate(s: string): Date | undefined {
  try {
    return parseDateKey(s);
  } catch {
    return undefined;
  }
}
