import { GlobeControl, Map as MlMap, NavigationControl, ScaleControl, setWorkerUrl, type LngLatBoundsLike, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 は自身の URL を基準にワーカーを探すため、バンドル後も見つかるよう明示的に指定する
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { registerJaxaProtocol } from "./jaxaProtocol";

/** JAXA レイヤーはこのレイヤーの下に差し込む（国境線を上に表示するため） */
export const OVERLAY_BEFORE_ID = "countries-boundary";

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      base: { type: "vector", url: "https://demotiles.maplibre.org/tiles/tiles.json" },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#0a1530" } },
      {
        id: "countries-fill",
        type: "fill",
        source: "base",
        "source-layer": "countries",
        paint: { "fill-color": "#26324d" },
      },
      {
        id: "countries-boundary",
        type: "line",
        source: "base",
        "source-layer": "countries",
        paint: { "line-color": "rgba(226,232,240,0.55)", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 6, 1.2] },
      },
    ],
  };
}

export interface MapOptions {
  center?: [number, number];
  zoom?: number;
  bounds?: LngLatBoundsLike;
  /** 地球儀で表示する（既定: true）。平面の地図は高緯度ほど大きく見え、北緯・南緯85°より先を表示できないため */
  globe?: boolean;
  controls?: boolean;
}

let workerConfigured = false;

export function createMap(container: HTMLElement, opts: MapOptions = {}): MlMap {
  if (!workerConfigured) {
    setWorkerUrl(workerUrl);
    workerConfigured = true;
  }
  registerJaxaProtocol();
  const map = new MlMap({
    container,
    style: baseStyle(),
    center: opts.center ?? [135, 20],
    zoom: opts.zoom ?? 1.2,
    minZoom: 0,
    maxZoom: 12,
    renderWorldCopies: true,
    attributionControl: {
      compact: true,
      customAttribution: '衛星データ: <a href="https://data.earth.jaxa.jp/" target="_blank" rel="noopener">JAXA Earth API</a> | 背景地図: MapLibre Demo Tiles',
    },
    cooperativeGestures: false,
    // 地図の操作ボタンの説明を日本語に
    locale: {
      "GlobeControl.Enable": "地球儀で表示",
      "GlobeControl.Disable": "平面の地図で表示",
      "NavigationControl.ZoomIn": "拡大",
      "NavigationControl.ZoomOut": "縮小",
      "NavigationControl.ResetBearing": "北を上にする",
    },
  });
  if (opts.bounds) map.fitBounds(opts.bounds, { padding: 20, duration: 0 });
  if (opts.controls !== false) {
    map.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
    // 地球儀 ⇔ 平面の地図 の切り替えボタン（全画面共通）
    map.addControl(new GlobeControl(), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
  }
  map.on("style.load", () => {
    if (opts.globe !== false) map.setProjection({ type: "globe" });
  });
  // 地図キャンバスにも説明を付ける（スクリーンリーダー向け）
  map.getCanvas().setAttribute("aria-label", "衛星データの地図。ドラッグで移動、ホイールやピンチで拡大縮小できます。");
  return map;
}

export function whenStyleLoaded(map: MlMap): Promise<void> {
  if (map.isStyleLoaded()) return Promise.resolve();
  return new Promise((resolve) => map.once("load", () => resolve()));
}

export function setGlobe(map: MlMap, on: boolean): void {
  map.setProjection({ type: on ? "globe" : "mercator" });
}

/** 2つの地図の視点を同期する（タイムマシンの比較表示用） */
export function syncMaps(a: MlMap, b: MlMap): () => void {
  let syncing = false;
  const mk = (from: MlMap, to: MlMap) => () => {
    if (syncing) return;
    syncing = true;
    to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
    syncing = false;
  };
  const ab = mk(a, b);
  const ba = mk(b, a);
  a.on("move", ab);
  b.on("move", ba);
  return () => {
    a.off("move", ab);
    b.off("move", ba);
  };
}
