import { Marker, type Map as MlMap } from "maplibre-gl";
import { getDataset } from "../core/datasetRegistry";
import { formatDateJa, toDateKey } from "../core/dates";
import { neighborhoodMean, lonLatToPixel, type Grid } from "../core/discoveries";
import { getAvailableRange, getGlobalGrid, getRegionSummary } from "../core/jaxaClient";
import { aggregateMonths, completeYears, RANKINGS, topRegions, transformValue, type GridRanking, type RankedRegion, type RankingDef, type SeasRanking } from "../core/ranking";
import { placeLabel } from "../core/regions";
import { formatNumber } from "../core/stats";
import type { DatasetDef } from "../core/types";
import { LayerManager } from "../map/layerManager";
import { createMap, whenStyleLoaded } from "../map/mapView";
import { gridToMercatorDataUrl, removeGridImage, showGridImage } from "../map/gridImage";
import { timeSeriesChart } from "../ui/chart";
import { h, hashQuery, replaceHashQuery, setChildren } from "../ui/dom";
import { mapStatus } from "../ui/mapStatus";
import type { Page } from "./page";

const TOP_N = 10;
const GRID_LAYER = "ranking-grid";
const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

interface Row {
  rank: number;
  name: string;
  lon: number;
  lat: number;
  value: number;
  /** 地域の月ごとの値（grid 型のみ） */
  monthly?: (number | null)[];
}

export const rankingPage: Page = {
  title: "地球データランキング",
  mount(root) {
    const q = hashQuery();
    let def: RankingDef = RANKINGS.find((r) => r.id === q.get("r")) ?? RANKINGS[0];
    let year: number | null = q.get("y") ? Number(q.get("y")) : null;
    let month: number | null = q.get("m") ? Number(q.get("m")) : null; // 0-11、null は年間
    let token = 0;
    let disposed = false;
    let rows: Row[] = [];
    let selected: number | null = null;
    let markers: Marker[] = [];
    let lm: LayerManager | null = null;
    let chartDestroy: (() => void) | null = null;

    // ---------------------------------------------------------------- layout
    const mapEl = h("div", { class: "map" });
    const status = mapStatus(() => lm?.reload());
    const legendEl = h("div", { class: "legend-mini" });
    const kindEl = h("div", { class: "chip-list", role: "list" });
    const periodEl = h("div", { class: "row" });
    const metaEl = h("div", null);
    const tableEl = h("div", { "aria-live": "polite" });
    const detailEl = h("div", null);
    setChildren(
      root,
      h(
        "div",
        { class: "page-lab" },
        h("div", { class: "lab-map" }, h("div", { class: "map-wrap" }, mapEl, status.el, h("div", { class: "lab-legends" }, legendEl))),
        h(
          "div",
          { class: "lab-panel" },
          h("section", { class: "card" }, h("h1", { class: "panel-title" }, "🏆 地球データランキング"), h("p", { class: "hint" }, "衛星データで、世界の地域をランキングにしました。順位をクリックすると、地図でその場所を確かめられます。"), kindEl,
            h("p", { class: "hint" }, "地図右上の 🌐 ボタンで、地球儀と平面の地図を切り替えられます。平面の地図では、北や南の地域ほど大きく見え、北緯・南緯85°より先は表示できません。")),
          h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "対象期間"), periodEl, metaEl),
          h("section", { class: "card" }, tableEl),
          detailEl,
        ),
      ),
    );
    // 平面の地図（メルカトル図法）は高緯度ほど面積が大きく見え、極付近は表示できないため、地球儀を既定にする
    const map: MlMap = createMap(mapEl, { center: [60, 15], zoom: 1.7 });

    // ---------------------------------------------------------------- kind
    function renderKinds() {
      setChildren(
        kindEl,
        RANKINGS.map((r) =>
          h("button", {
            type: "button", role: "listitem", class: "chip", "aria-pressed": String(r.id === def.id),
            onclick: () => {
              if (r.id === def.id) return;
              def = r;
              month = null;
              void refresh(true);
            },
          }, `${r.icon} ${r.title}`),
        ),
      );
    }

    // ---------------------------------------------------------------- period
    async function renderPeriod(ds: DatasetDef) {
      const { first, last } = await getAvailableRange(ds);
      if (def.type === "seas") {
        // 日別データ：年と月をえらび、その月の15日のデータを使う
        const years: number[] = [];
        for (let y = last.getUTCFullYear(); y >= first.getUTCFullYear(); y--) years.push(y);
        if (year == null || !years.includes(year)) year = last.getUTCFullYear();
        if (month == null) month = last.getUTCDate() >= 15 ? last.getUTCMonth() : (last.getUTCMonth() + 11) % 12;
        // 最新月がまだ15日前なら前の月
        if (year === last.getUTCFullYear() && (month > last.getUTCMonth() || (month === last.getUTCMonth() && last.getUTCDate() < 15))) {
          month = last.getUTCMonth() - (last.getUTCDate() < 15 ? 1 : 0);
          if (month < 0) {
            month = 11;
            year--;
          }
        }
        setChildren(periodEl, yearSelect(years), monthSelect(false));
        return;
      }
      const years = completeYears(first, last);
      if (!years.length) throw new Error("12か月そろった年がありません");
      if (year == null || !years.includes(year)) year = years[0];
      setChildren(periodEl, yearSelect(years), def.yearOnly ? h("span", { class: "hint" }, "（1年間で集計）") : monthSelect(true));
    }

    function yearSelect(years: number[]) {
      const sel = h("select", { class: "input", "aria-label": "年", onchange: () => ((year = Number(sel.value)), void refresh(false)) },
        years.map((y) => h("option", { value: String(y), selected: y === year }, `${y}年`)));
      return sel;
    }
    function monthSelect(allowYear: boolean) {
      const sel = h("select", { class: "input", "aria-label": "月", onchange: () => ((month = sel.value === "" ? null : Number(sel.value)), void refresh(false)) },
        allowYear ? h("option", { value: "", selected: month == null }, "1年間") : null,
        MONTHS.map((m, i) => h("option", { value: String(i), selected: i === month }, m)));
      return sel;
    }

    function renderMeta(ds: DatasetDef, period: string, resolution: string) {
      setChildren(
        metaEl,
        h("table", { class: "meta-table" }, h("tbody", null,
          [
            ["対象期間", period],
            ["集計方法", def.type === "grid" && month != null ? `${MONTHS[month]}の月平均の値（${def.valueLabel.replace(/（.*）/, "")}）` : def.aggregation],
            ["対象地域", def.area],
            ["データ解像度", resolution],
            ["データ", `${ds.icon} ${ds.name}（${ds.source.satellite}）`],
          ].map(([k, v]) => h("tr", null, h("th", { scope: "row" }, k), h("td", null, v))))),
        h("p", { class: "hint" }, def.description),
        h("p", { class: "caution" }, "⚠️ ", def.caution),
      );
    }

    // ---------------------------------------------------------------- compute
    async function refresh(resetPeriod: boolean) {
      const t = ++token;
      renderKinds();
      chartDestroy?.();
      chartDestroy = null;
      setChildren(detailEl);
      selected = null;
      const ds = getDataset(def.dataset)!;
      setChildren(tableEl, h("p", { class: "hint", role: "status" }, "🛰️ 衛星データを集計しています…"));
      try {
        if (resetPeriod) year = null;
        await renderPeriod(ds);
        if (t !== token || disposed) return;
        replaceHashQuery({ r: def.id, y: String(year), m: month == null ? null : String(month) });
        rows = def.type === "grid" ? await computeGrid(def, ds, t) : await computeSeas(def, ds);
        if (t !== token || disposed) return;
        renderTable();
        renderMarkers();
        // 地球儀では裏側の地域が見えないので、1位の地域を正面に向ける
        if (def.type === "grid" && rows[0]) map.easeTo({ center: [rows[0].lon, rows[0].lat * 0.5], zoom: map.getProjection()?.type === "globe" ? 1.7 : 1.4, duration: 800 });
      } catch (e) {
        if (t === token) setChildren(tableEl, h("p", { class: "error", role: "alert" }, `集計できませんでした：${(e as Error).message}`));
      }
    }

    async function computeGrid(r: GridRanking, ds: DatasetDef, t: number): Promise<Row[]> {
      const y = year!;
      const months = month == null ? MONTHS.map((_, i) => i) : [month];
      let done = 0;
      const raws = await Promise.all(
        months.map(async (m) => {
          const g = await getGlobalGrid(ds, new Date(Date.UTC(y, m, 1)));
          if (t === token) setChildren(tableEl, h("p", { class: "hint", role: "status" }, `🛰️ 衛星データを集計しています…（${++done}/${months.length}か月）`));
          return { m, g };
        }),
      );
      // 単位をそろえる（降水強度 → 月降水量、K → ℃）
      const grids: Grid[] = raws.map(({ m, g }) => ({ ...g, data: Float32Array.from(g.data as ArrayLike<number>, (v) => transformValue(v, r.transform, y, m)) }));
      const agg = month == null ? aggregateMonths(grids, r.metric, r.metric === "range" ? 11 : 8) : grids[0];
      const unit = month != null && r.monthUnitLabel ? r.monthUnitLabel : r.unitLabel;
      const disp = month != null && r.monthDisplay ? r.monthDisplay : r.display;
      renderMeta(ds, month == null ? `${y}年1月〜12月` : `${y}年${MONTHS[month]}`, `${ds.spatialResolution} のデータを1°（約110km）格子に集計し、周囲3°（約300km四方）の平均で順位づけ`);
      renderGridLegend(disp, unit);
      const url = await gridToMercatorDataUrl(agg, { min: disp.min, max: disp.max, colors: disp.colors });
      if (t !== token || disposed) return [];
      lm?.clear();
      showGridImage(map, GRID_LAYER, url);
      const top: RankedRegion[] = topRegions(agg, TOP_N, r.latRange, 1500, r.minCoverage);
      return top.map((x) => {
        const px = lonLatToPixel(agg, x.lon, x.lat)!;
        return {
          rank: x.rank,
          name: placeLabel(x.lon, x.lat),
          lon: x.lon,
          lat: x.lat,
          value: x.value,
          monthly: month == null ? grids.map((g) => { const v = neighborhoodMean(g, px[0], px[1], 1); return Number.isFinite(v) ? v : null; }) : undefined,
        };
      });
    }

    async function computeSeas(r: SeasRanking, ds: DatasetDef): Promise<Row[]> {
      const date = new Date(Date.UTC(year!, month!, 15));
      renderMeta(ds, `${formatDateJa(date, "daily")}`, `${ds.spatialResolution}`);
      removeGridImage(map, GRID_LAYER);
      lm?.clear();
      lm?.add({ id: "rank", datasetKey: ds.key, dateKey: toDateKey(date, "daily"), opacity: 0.85, visible: true });
      setChildren(legendEl, h("div", { class: "legend-title" }, `${ds.icon} ${ds.shortName}（${formatDateJa(date, "daily")}）`));
      // 北極点の近くまで見えるよう、北極の真上から見る
      map.jumpTo({ center: [0, 80], zoom: map.getProjection()?.type === "globe" ? 0.9 : 1.4 });
      let done = 0;
      const vals = await Promise.all(
        r.seas.map(async (s) => {
          const sum = await getRegionSummary(ds, date, s.bbox, 48);
          setChildren(tableEl, h("p", { class: "hint", role: "status" }, `🛰️ 海域ごとに集計しています…（${++done}/${r.seas.length}）`));
          return { s, v: sum.mean };
        }),
      );
      return vals
        .filter((x): x is { s: (typeof r.seas)[number]; v: number } => x.v != null)
        .sort((a, b) => b.v - a.v)
        .map((x, i) => ({ rank: i + 1, name: x.s.name, lon: (x.s.bbox[0] + x.s.bbox[2]) / 2, lat: (x.s.bbox[1] + x.s.bbox[3]) / 2, value: x.v }));
    }

    function renderGridLegend(d: { min: number; max: number; colors: string | string[] }, unit: string) {
      // 凡例はカラーバーと数値（共通の legend は datasets.json 用のため、ここで簡易に描く）
      const grad = Array.isArray(d.colors) ? `linear-gradient(90deg, ${d.colors.map((c) => `#${c}`).join(",")})` : "linear-gradient(90deg,#00008f,#0000ff,#00ffff,#ffff00,#ff0000,#800000)";
      setChildren(
        legendEl,
        h("div", { class: "legend-title" }, `${def.icon} ${def.valueLabel}`, h("span", { class: "legend-unit" }, unit ? ` 単位: ${unit}` : "")),
        h("div", { class: "legend-bar", style: `background:${grad}`, role: "img", "aria-label": `${formatNumber(d.min)}から${formatNumber(d.max)}${unit}` }),
        h("div", { class: "legend-ticks", "aria-hidden": "true" }, [0, 0.5, 1].map((t) => h("span", { style: `left:${t * 100}%` }, formatNumber(d.min + (d.max - d.min) * t)))),
      );
    }

    // ---------------------------------------------------------------- output
    const unitNow = () => (def.type === "grid" && month != null && def.monthUnitLabel ? def.monthUnitLabel : def.unitLabel);
    const fmt = (v: number) => `${formatNumber(v, def.unitLabel === "" ? 2 : undefined)}${unitNow() ? ` ${unitNow()}` : ""}`;

    function renderTable() {
      if (!rows.length) {
        setChildren(tableEl, h("p", { class: "hint" }, "この期間のデータがありません。"));
        return;
      }
      const max = Math.max(...rows.map((r) => r.value));
      setChildren(
        tableEl,
        h("h2", { class: "panel-heading" }, `${def.icon} ${def.title} トップ${rows.length}`),
        h("ol", { class: "rank-list" },
          rows.map((r, i) =>
            h("li", null,
              h("button", { type: "button", class: `rank-row${selected === i ? " selected" : ""}`, onclick: () => select(i) },
                h("span", { class: `rank-num rank-${r.rank}` }, String(r.rank)),
                h("span", { class: "rank-name" }, r.name),
                h("span", { class: "rank-value" }, fmt(r.value)),
                h("span", { class: "rank-bar", "aria-hidden": "true", style: `width:${Math.max(4, (r.value / max) * 100)}%` }))))),
      );
    }

    function renderMarkers() {
      markers.forEach((m) => m.remove());
      markers = rows.map((r, i) => {
        const el = h("button", { type: "button", class: `rank-marker rank-${r.rank}`, "aria-label": `${r.rank}位 ${r.name}` }, String(r.rank));
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          select(i);
        });
        return new Marker({ element: el }).setLngLat([r.lon, r.lat]).addTo(map);
      });
    }

    function select(i: number) {
      selected = i;
      renderTable();
      const r = rows[i];
      map.flyTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), def.type === "seas" ? 2.5 : 3.5) });
      chartDestroy?.();
      chartDestroy = null;
      const ds = getDataset(def.dataset)!;
      const link =
        def.type === "seas"
          ? h("a", { class: "btn btn-sm", href: `#/timemachine?ds=${ds.key}&a=${year! - 1}-${String(month! + 1).padStart(2, "0")}-15&b=${year}-${String(month! + 1).padStart(2, "0")}-15` }, "⏳ 去年の同じ日とくらべる")
          : h("a", { class: "btn btn-sm", href: `#/map?ds=${ds.key}&date=${year}-${String((month ?? 6) + 1).padStart(2, "0")}&c=${r.lon.toFixed(1)},${r.lat.toFixed(1)},5` }, "🗺️ 探検マップで見る");
      const box = h("section", { class: "card" },
        h("h2", { class: "panel-heading" }, `${r.rank}位の地域`),
        h("p", { class: "discovery-place" }, `📍 ${r.name}`),
        h("p", null, `${def.valueLabel}：`, h("strong", null, fmt(r.value))),
        h("div", { class: "row" }, link));
      if (r.monthly && def.type === "grid") {
        const monthlyUnit = def.monthUnitLabel ?? def.unitLabel;
        const chart = timeSeriesChart(
          [{ label: def.valueLabel.replace(/（.*）/, ""), unit: monthlyUnit || "単位なし", color: "#38bdf8", points: r.monthly.map((v, m) => ({ t: Date.UTC(year!, m, 1), v })) }],
          { title: `${r.name}の月ごとの変化`, height: 200 },
        );
        box.append(h("h3", null, `${year}年の月ごとの変化`), chart.el);
        chartDestroy = chart.destroy;
      } else if (def.type === "seas") {
        box.append(h("p", { class: "hint" }, "日別の海氷データは時系列グラフに対応していません。タイムマシンで別の日とくらべてみよう。"));
      }
      setChildren(detailEl, box);
    }

    // ---------------------------------------------------------------- init
    renderKinds();
    void whenStyleLoaded(map).then(() => {
      if (disposed) return;
      lm = new LayerManager(map);
      void refresh(false);
    });
    return () => {
      disposed = true;
      chartDestroy?.();
      markers.forEach((m) => m.remove());
      status.destroy();
      map.remove();
    };
  },
};

