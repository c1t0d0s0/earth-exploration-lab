import type { Feature } from "geojson";
import { Marker, type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import satsRaw from "../data/satellites.json";
import { getDataset } from "../core/datasetRegistry";
import { formatDateJa } from "../core/dates";
import { getAvailableRange, getOverviewCanvas, isPolar } from "../core/jaxaClient";
import {
  bearingDeg,
  destination,
  findPasses,
  groundTrack,
  localSolarTime,
  makeOrbit,
  periodMinutes,
  subSatellitePoint,
  type OrbitModel,
  type Pass,
  type TrackPoint,
} from "../core/orbit";
import { formatNumber } from "../core/stats";
import { createMap, whenStyleLoaded } from "../map/mapView";
import { h, hashQuery, replaceHashQuery, setChildren } from "../ui/dom";
import { renderLegend } from "../ui/legend";
import { describePoint, formatLngLat, wrapLng } from "../ui/pointValue";
import type { Page } from "./page";

interface Sensor {
  id: string;
  name: string;
  kind: keyof typeof satsRaw.sensorKinds;
  swathKm: number;
}
interface Satellite {
  id: string;
  name: string;
  icon: string;
  role: string;
  altitudeKm: number;
  altitudeNote: string;
  orbit: "sun-synchronous" | "inclined";
  inclinationDeg?: number;
  localTimeDescending?: number;
  localTimeNote: string;
  recurrenceDays?: number;
  sensors: Sensor[];
  products: string[];
  sources: { label: string; url: string }[];
}
interface SensorKind {
  label: string;
  simple: string;
  detail: string;
  needsDaylight: boolean;
  throughClouds: boolean;
}

const SATS = satsRaw.satellites as Satellite[];
const KINDS = satsRaw.sensorKinds as Record<string, SensorKind>;
const TARGETS = satsRaw.targets;
const DURATIONS = [
  { label: "1周", hours: 0 },
  { label: "1日", hours: 24 },
  { label: "3日", hours: 72 },
];
const SPEEDS = [
  { label: "ゆっくり（1秒で2分）", min: 2 },
  { label: "ふつう（1秒で10分）", min: 10 },
  { label: "はやい（1秒で1時間）", min: 60 },
];
const STEP_SEC = 20;

const fmtTime = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const fmtLocal = (lt: number) => `${Math.floor(lt)}時${String(Math.floor((lt % 1) * 60)).padStart(2, "0")}分`;

export const satellitePage: Page = {
  title: "観測衛星シミュレーター",
  mount(root) {
    const q = hashQuery();
    let sat: Satellite = SATS.find((s) => s.id === q.get("s")) ?? SATS[0];
    let sensor: Sensor = sat.sensors[0];
    let target: { name: string; lon: number; lat: number } = TARGETS[0];
    let durationIdx = 1;
    let speedIdx = 1;
    let orbit: OrbitModel;
    let track: TrackPoint[] = [];
    let edges: { left: [number, number]; right: [number, number] }[] = [];
    let passes: Pass[] = [];
    let t0 = 0;
    let tEnd = 0;
    let simT = 0;
    let playing = false;
    let raf = 0;
    let lastFrame = 0;
    let lastDraw = 0;
    let disposed = false;

    // ---------------------------------------------------------------- layout
    const mapEl = h("div", { class: "map" });
    const satEl = h("div", { class: "sat-cards", role: "radiogroup", "aria-label": "衛星" });
    const specEl = h("div", null);
    const sensorEl = h("div", { class: "row" });
    const targetEl = h("div", null);
    const controlEl = h("div", null);
    const clockEl = h("p", { class: "sim-clock", "aria-live": "off" });
    const passesEl = h("div", { "aria-live": "polite" });
    const resultEl = h("div", null);
    const explainEl = h("div", null);
    setChildren(
      root,
      h(
        "div",
        { class: "page-lab" },
        h("div", { class: "lab-map" }, h("div", { class: "map-wrap" }, mapEl, h("div", { class: "sim-overlay" }, clockEl))),
        h(
          "div",
          { class: "lab-panel" },
          h("section", { class: "card" },
            h("h1", { class: "panel-title" }, "🛰️ 観測衛星シミュレーター"),
            h("p", { class: "hint" }, "人工衛星は地球のまわりを回りながら、真下の帯のような範囲（観測幅）を観測しています。衛星をえらんで動かしてみよう。")),
          h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "① 衛星をえらぶ"), satEl, specEl),
          h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "② センサー（観測のしかた）"), sensorEl, explainEl),
          h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "③ 観測したい場所"), targetEl),
          h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "④ シミュレーション"), controlEl, passesEl),
          h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "⑤ 観測結果を見る"), resultEl),
          h("p", { class: "hint" }, "※ 軌道は、公式資料の高度・観測時刻をもとに、円軌道と地球の扁平による軌道面の回転だけを考えた簡易モデルで計算しています。実際の衛星の現在位置ではありません。"),
        ),
      ),
    );

    const map: MlMap = createMap(mapEl, { center: [target.lon, target.lat], zoom: 1.2 });
    const satMarker = new Marker({ element: h("div", { class: "sat-marker", "aria-hidden": "true" }, "🛰️") });
    const targetMarker = new Marker({ color: "#f59e0b" });

    // ---------------------------------------------------------------- panels
    function renderSats() {
      setChildren(
        satEl,
        SATS.map((s) =>
          h("button", {
            type: "button", role: "radio", class: "sat-card", "aria-checked": String(s.id === sat.id),
            onclick: () => {
              if (s.id === sat.id) return;
              sat = s;
              sensor = s.sensors[0];
              rebuild();
            },
          }, h("span", { class: "sat-name" }, `${s.icon} ${s.name}`), h("span", { class: "sat-role" }, s.role)),
        ),
      );
    }

    function renderSpec() {
      const computedIncl = sat.orbit === "sun-synchronous";
      const per = periodMinutes(sat.altitudeKm);
      const rows: [string, string, string][] = [
        ["高度", sat.altitudeNote, "公式"],
        ["軌道", sat.orbit === "sun-synchronous" ? "太陽同期準回帰軌道" : "太陽非同期軌道", "公式"],
        ["軌道傾斜角", `${formatNumber(orbit.inclDeg, 1)}°`, computedIncl ? "計算" : "公式"],
        ["周期（1周の時間）", `約${formatNumber(per, 1)}分`, "計算"],
        ["1日に地球を回る回数", `約${formatNumber(1440 / per, 1)}周`, "計算"],
        ["観測する時刻", sat.localTimeNote, "公式"],
      ];
      if (sat.recurrenceDays) rows.push(["同じ場所の真上にもどるまで", `${sat.recurrenceDays}日（回帰日数）`, "公式"]);
      setChildren(
        specEl,
        h("table", { class: "meta-table" }, h("tbody", null, rows.map(([k, v, src]) => h("tr", null, h("th", { scope: "row" }, k), h("td", null, v), h("td", null, h("span", { class: `src-tag src-${src === "公式" ? "official" : "calc"}` }, src)))))),
        h("p", { class: "hint" }, "「公式」は下の資料の値、「計算」は高度などから物理の式で求めた値です。",
          computedIncl ? " 太陽同期軌道の傾斜角は、地球の扁平による軌道面の回転がちょうど1年で1周になる条件から求めています。" : ""),
        h("details", null, h("summary", null, "出典"), h("ul", null, sat.sources.map((s) => h("li", null, h("a", { href: s.url, target: "_blank", rel: "noopener" }, s.label))))),
      );
    }

    function renderSensor() {
      setChildren(
        sensorEl,
        h("select", {
          class: "input", "aria-label": "センサー",
          onchange: (e: Event) => {
            sensor = sat.sensors.find((x) => x.id === (e.target as HTMLSelectElement).value)!;
            rebuild();
          },
        }, sat.sensors.map((s) => h("option", { value: s.id, selected: s.id === sensor.id }, `${s.name}（観測幅 ${s.swathKm}km）`))),
      );
      const k = KINDS[sensor.kind];
      setChildren(
        explainEl,
        h("p", null, h("strong", null, k.label)),
        h("p", null, k.simple),
        h("ul", { class: "kind-flags" },
          h("li", null, k.needsDaylight ? "☀️ 昼だけ観測できる" : "🌙 昼も夜も観測できる"),
          h("li", null, k.throughClouds ? "☁️ 雲を通りぬけて観測できる" : "☁️ 雲があると地面が見えない")),
        h("details", null, h("summary", null, "くわしい説明"), h("p", { class: "detail" }, k.detail)),
      );
    }

    function renderTarget() {
      setChildren(
        targetEl,
        h("div", { class: "chip-list" },
          TARGETS.map((t) => h("button", { type: "button", class: "chip", "aria-pressed": String(t.name === target.name), onclick: () => setTarget(t) }, `📍 ${t.name}`))),
        h("p", { class: "hint" }, `いまの場所：${target.name}（${formatLngLat(target.lon, target.lat)}）。地図をクリックしても場所を変えられます。`),
      );
    }

    function renderControls() {
      setChildren(
        controlEl,
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn btn-primary", onclick: () => togglePlay() }, playing ? "⏸ 一時停止" : "▶ 動かす"),
          h("button", { type: "button", class: "btn", onclick: () => showAll() }, "⏭ 最後まで一気に"),
          h("button", { type: "button", class: "btn btn-sm", onclick: () => reset() }, "最初から")),
        h("div", { class: "row" },
          h("label", { class: "field-inline" }, h("span", { class: "field-label" }, "期間"),
            h("select", { class: "select-sm", onchange: (e: Event) => ((durationIdx = Number((e.target as HTMLSelectElement).value)), rebuild()) },
              DURATIONS.map((d, i) => h("option", { value: String(i), selected: i === durationIdx }, d.label)))),
          h("label", { class: "field-inline" }, h("span", { class: "field-label" }, "速さ"),
            h("select", { class: "select-sm", onchange: (e: Event) => (speedIdx = Number((e.target as HTMLSelectElement).value)) },
              SPEEDS.map((d, i) => h("option", { value: String(i), selected: i === speedIdx }, d.label))))),
      );
    }

    // ---------------------------------------------------------------- compute
    function setTarget(t: { name: string; lon: number; lat: number }) {
      target = t;
      targetMarker.setLngLat([t.lon, t.lat]).addTo(map);
      renderTarget();
      computePasses();
      drawUpTo(simT);
      renderPasses();
      void renderResult();
    }

    function computePasses() {
      passes = findPasses(track, [target.lon, target.lat], sensor.swathKm / 2);
    }

    function rebuild() {
      stop();
      replaceHashQuery({ s: sat.id });
      t0 = Math.floor(Date.now() / 60000) * 60000;
      orbit = makeOrbit({
        altKm: sat.altitudeKm,
        inclDeg: sat.orbit === "inclined" ? sat.inclinationDeg : undefined,
        localTimeDescending: sat.orbit === "sun-synchronous" ? sat.localTimeDescending : undefined,
        t0,
      });
      const hours = DURATIONS[durationIdx].hours || periodMinutes(sat.altitudeKm) / 60;
      tEnd = t0 + hours * 3600e3;
      track = groundTrack(orbit, t0, tEnd, STEP_SEC);
      // 観測幅の両端（進行方向に対して左右に、観測幅の半分ずつ）
      edges = track.map((p, k) => {
        const a = track[Math.max(0, k - 1)];
        const b = track[Math.min(track.length - 1, k + 1)];
        const brg = bearingDeg(a.lon, a.lat, b.lon, b.lat);
        return { left: destination(p.lon, p.lat, brg - 90, sensor.swathKm / 2), right: destination(p.lon, p.lat, brg + 90, sensor.swathKm / 2) };
      });
      computePasses();
      simT = t0;
      renderSats();
      renderSpec();
      renderSensor();
      renderControls();
      drawUpTo(simT);
      renderPasses();
      void renderResult();
    }

    // ---------------------------------------------------------------- draw
    function indexAt(t: number) {
      return Math.min(track.length - 1, Math.max(0, Math.floor((t - t0) / (STEP_SEC * 1000))));
    }

    function drawUpTo(t: number) {
      if (!map.getSource("sim-track")) return;
      const n = indexAt(t);
      // 日付変更線をまたぐところで線を分ける
      const lines: [number, number][][] = [[]];
      const quads: Feature[] = [];
      const hitTimes = passes.filter((p) => p.t <= t).map((p) => p.t);
      for (let k = 0; k <= n; k++) {
        const p = track[k];
        const cur = lines[lines.length - 1];
        if (cur.length && Math.abs(cur[cur.length - 1][0] - p.lon) > 180) lines.push([]);
        lines[lines.length - 1].push([p.lon, p.lat]);
        if (k === 0) continue;
        const e0 = edges[k - 1];
        const e1 = edges[k];
        const ring = [e0.left, e1.left, e1.right, e0.right];
        const lons = ring.map((x) => x[0]);
        if (Math.max(...lons) - Math.min(...lons) > 180) continue; // 日付変更線・極付近は省略
        const hit = hitTimes.some((ht) => Math.abs(ht - p.t) < STEP_SEC * 1500);
        quads.push({ type: "Feature", properties: { hit }, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } });
      }
      (map.getSource("sim-track") as GeoJSONSource).setData({ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines.filter((l) => l.length > 1) } });
      (map.getSource("sim-swath") as GeoJSONSource).setData({ type: "FeatureCollection", features: quads });
      const [lon, lat] = subSatellitePoint(orbit, t);
      satMarker.setLngLat([lon, lat]).addTo(map);
      const lt = localSolarTime(lon, t);
      clockEl.textContent = `🕒 世界時 ${fmtTime(t)}（${formatNumber((t - t0) / 3600e3, 1)}時間後）　衛星の真下の地方時 ${fmtLocal(lt)}　観測 ${hitTimes.length}回`;
    }

    function frame(now: number) {
      if (!playing || disposed) return;
      const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
      lastFrame = now;
      simT = Math.min(tEnd, simT + dt * SPEEDS[speedIdx].min * 60e3);
      if (now - lastDraw > 80 || simT >= tEnd) {
        lastDraw = now;
        drawUpTo(simT);
        renderPassesIfChanged();
      }
      if (simT >= tEnd) {
        stop();
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    function togglePlay() {
      if (playing) stop();
      else {
        if (simT >= tEnd) simT = t0;
        playing = true;
        lastFrame = 0;
        raf = requestAnimationFrame(frame);
        renderControls();
      }
    }
    function stop() {
      playing = false;
      cancelAnimationFrame(raf);
      renderControls();
    }
    function showAll() {
      stop();
      simT = tEnd;
      drawUpTo(simT);
      renderPasses();
    }
    function reset() {
      stop();
      simT = t0;
      drawUpTo(simT);
      renderPasses();
    }

    // ---------------------------------------------------------------- passes
    let shownPasses = -1;
    function renderPassesIfChanged() {
      const n = passes.filter((p) => p.t <= simT).length;
      if (n !== shownPasses) renderPasses();
    }

    function renderPasses() {
      const done = passes.filter((p) => p.t <= simT);
      shownPasses = done.length;
      const k = KINDS[sensor.kind];
      const usable = done.filter((p) => !k.needsDaylight || p.sunElevation > 0);
      const total = passes.length;
      const totalUsable = passes.filter((p) => !k.needsDaylight || p.sunElevation > 0).length;
      const dur = DURATIONS[durationIdx].hours ? DURATIONS[durationIdx].label : "1周";
      setChildren(
        passesEl,
        h("p", null, `📍 ${target.name}の上を観測幅が通った回数：`, h("strong", null, `${done.length}回`), simT < tEnd ? `（${dur}では全部で${total}回）` : `（${dur}）`),
        k.needsDaylight ? h("p", { class: "hint" }, `そのうち、昼（太陽が出ている）で観測できるのは ${usable.length}回${simT < tEnd ? `（全部で${totalUsable}回）` : ""}。光学センサーは夜は観測できません。`) : null,
        !k.throughClouds ? h("p", { class: "hint" }, "☁️ さらに、雲があるときは地面が見えません。") : null,
        done.length
          ? h("div", { class: "table-scroll" }, h("table", { class: "meta-table" },
              h("thead", null, h("tr", null, h("th", { scope: "col" }, "時刻（世界時）"), h("th", { scope: "col" }, "その場所の時刻"), h("th", { scope: "col" }, "軌跡からの距離"), h("th", { scope: "col" }, "観測"))),
              h("tbody", null, done.map((p) => {
                const day = p.sunElevation > 0;
                const ok = !k.needsDaylight || day;
                return h("tr", null,
                  h("td", null, fmtTime(p.t)),
                  h("td", null, `${fmtLocal(localSolarTime(target.lon, p.t))}${day ? " ☀️" : " 🌙"}`),
                  h("td", null, `${formatNumber(p.distanceKm, 0)}km`),
                  h("td", null, ok ? "◯ できる" : "✕ 暗い"));
              }))))
          : h("p", { class: "hint" }, "まだ観測幅が通っていません。「▶ 動かす」を押してみよう。"),
        DURATIONS[durationIdx].hours === 0 ? h("p", { class: "hint" }, "1周だけでは、ほとんどの場所は観測できません。期間を「1日」「3日」にしてみよう。地球が自転するので、周回するたびに観測する場所が西へずれていきます。") : null,
      );
    }

    // ---------------------------------------------------------------- result
    let resultToken = 0;
    async function renderResult() {
      const t = ++resultToken;
      const products = sat.products.map((k) => getDataset(k)!).filter(Boolean);
      const sel = h("select", { class: "input", "aria-label": "データ", onchange: () => void show(products.find((p) => p.key === sel.value)!) },
        products.map((p) => h("option", { value: p.key }, `${p.icon} ${p.name}`)));
      const body = h("div", null);
      setChildren(resultEl,
        h("p", { class: "hint" }, `${sat.name}が観測したデータから作られた、${target.name}付近の最新のデータです。`),
        products.length > 1 ? sel : null, body);
      const show = async (ds: NonNullable<ReturnType<typeof getDataset>>) => {
        setChildren(body, h("p", { class: "hint", role: "status" }, "🛰️ データを読み込んでいます…"));
        try {
          const { last } = await getAvailableRange(ds);
          const half = Math.max(sensor.swathKm / 2, 150);
          const dLat = Math.min(30, half / 111);
          const dLon = Math.min(60, half / (111 * Math.max(0.2, Math.cos((target.lat * Math.PI) / 180))));
          const bbox: [number, number, number, number] = [
            Math.max(-180, target.lon - dLon), Math.max(-90, target.lat - dLat), Math.min(180, target.lon + dLon), Math.min(90, target.lat + dLat),
          ];
          const legend = h("div", null);
          void renderLegend(legend, ds, { compact: true });
          const valueText = await describePoint(ds, last, target.lon, target.lat);
          let img: Node | null = null;
          if (!isPolar(ds)) {
            const { canvas } = await getOverviewCanvas(ds, last, 256, Math.max(64, Math.round((256 * (bbox[3] - bbox[1])) / (bbox[2] - bbox[0]))), bbox);
            canvas.classList.add("sim-chip");
            canvas.setAttribute("role", "img");
            canvas.setAttribute("aria-label", `${target.name}付近の${ds.shortName}の画像`);
            img = canvas;
          }
          if (t !== resultToken || disposed) return;
          setChildren(body,
            img ? h("figure", { class: "sim-figure" }, img, h("figcaption", { class: "hint" }, `${target.name}を中心に、観測幅（${sensor.swathKm}km）ほどの範囲`)) : h("p", { class: "hint" }, "このデータは北極域投影のため、画像のかわりに地点の値を表示します。"),
            legend,
            h("p", { class: "pre-line" }, valueText),
            h("p", null, h("a", { class: "btn btn-sm", href: `#/map?ds=${ds.key}&c=${target.lon.toFixed(1)},${target.lat.toFixed(1)},4` }, "🗺️ 探検マップでくわしく見る")),
            ds.key === "precip-daily" ? h("p", { class: "hint" }, "※ 降水量（GSMaP）は、GPM主衛星のデータを基準に、ほかの多くの衛星のデータを組み合わせて作られています。") : null,
            h("p", { class: "hint" }, `データ：${formatDateJa(last, ds.temporal)}・${ds.source.satellite}`),
          );
        } catch (e) {
          if (t === resultToken) setChildren(body, h("p", { class: "error" }, `データを読み込めませんでした：${(e as Error).message}`));
        }
      };
      if (products[0]) await show(products[0]);
    }

    // ---------------------------------------------------------------- init
    map.on("click", (e) => setTarget({ name: "えらんだ場所", lon: wrapLng(e.lngLat.lng), lat: e.lngLat.lat }));
    renderTarget();
    void whenStyleLoaded(map).then(() => {
      if (disposed) return;
      map.addSource("sim-swath", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("sim-track", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "sim-swath", type: "fill", source: "sim-swath", paint: { "fill-color": ["case", ["get", "hit"], "#f59e0b", "#38bdf8"], "fill-opacity": ["case", ["get", "hit"], 0.55, 0.28] } });
      map.addLayer({ id: "sim-track", type: "line", source: "sim-track", paint: { "line-color": "#e0f2fe", "line-width": 1.5, "line-dasharray": [2, 2] } });
      targetMarker.setLngLat([target.lon, target.lat]).addTo(map);
      rebuild();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      satMarker.remove();
      targetMarker.remove();
      map.remove();
    };
  },
};
