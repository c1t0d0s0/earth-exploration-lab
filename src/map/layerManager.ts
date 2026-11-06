import type { Map as MlMap, RasterTileSource } from "maplibre-gl";
import { getDataset } from "../core/datasetRegistry";
import { OVERLAY_BEFORE_ID } from "./mapView";
import { tileUrl } from "./jaxaProtocol";

export interface LayerState {
  id: string;
  datasetKey: string;
  dateKey: string;
  opacity: number;
  visible: boolean;
}

interface Slot {
  state: LayerState;
  /** 2つのソースを交互に使い、次の時刻を裏で読み込んでから切り替える（ちらつき防止） */
  active: 0 | 1;
  loadToken: number;
}

const srcId = (id: string, buf: 0 | 1) => `jaxa-${id}-${buf}`;

function waitForSource(map: MlMap, sourceId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      map.off("sourcedata", onData);
      map.off("idle", onIdle);
      resolve();
    };
    const loaded = () => {
      // レイヤー削除・地図破棄の後はソースが無いので待つのをやめる
      if (!map.style || !map.getSource(sourceId)) return true;
      return map.isSourceLoaded(sourceId);
    };
    const onData = (e: { sourceId?: string }) => {
      if (e.sourceId === sourceId && loaded()) setTimeout(() => loaded() && done(), 30);
    };
    const onIdle = () => done();
    const timer = setTimeout(done, timeoutMs);
    map.on("sourcedata", onData);
    map.on("idle", onIdle);
  });
}

/** 地図上の JAXA データレイヤー（複数可）を管理する */
export class LayerManager {
  private slots: Slot[] = [];
  /** ページ移動などで地図が破棄された後は何もしない */
  private removed = false;

  constructor(private readonly map: MlMap) {
    map.once("remove", () => {
      this.removed = true;
    });
  }

  list(): LayerState[] {
    return this.slots.map((s) => ({ ...s.state }));
  }

  has(id: string): boolean {
    return this.slots.some((s) => s.state.id === id);
  }

  add(state: LayerState): void {
    if (this.has(state.id)) this.remove(state.id);
    const ds = getDataset(state.datasetKey);
    if (!ds) throw new Error(`unknown dataset ${state.datasetKey}`);
    const slot: Slot = { state: { ...state }, active: 0, loadToken: 0 };
    this.slots.push(slot);
    for (const buf of [0, 1] as const) {
      this.map.addSource(srcId(state.id, buf), {
        type: "raster",
        tiles: [tileUrl(ds.key, state.dateKey)],
        tileSize: 256,
        minzoom: 0,
        maxzoom: ds.maxZoom,
      });
      this.map.addLayer(
        {
          id: srcId(state.id, buf),
          type: "raster",
          source: srcId(state.id, buf),
          layout: { visibility: state.visible && buf === 0 ? "visible" : "none" },
          paint: {
            "raster-opacity": buf === 0 ? state.opacity : 0,
            "raster-fade-duration": 0,
            "raster-resampling": ds.valueKind === "classified" ? "nearest" : "linear",
          },
        },
        this.map.getLayer(OVERLAY_BEFORE_ID) ? OVERLAY_BEFORE_ID : undefined,
      );
    }
    this.reorder();
  }

  remove(id: string): void {
    if (this.removed) return;
    const i = this.slots.findIndex((s) => s.state.id === id);
    if (i < 0) return;
    for (const buf of [0, 1] as const) {
      if (this.map.getLayer(srcId(id, buf))) this.map.removeLayer(srcId(id, buf));
      if (this.map.getSource(srcId(id, buf))) this.map.removeSource(srcId(id, buf));
    }
    this.slots.splice(i, 1);
  }

  clear(): void {
    for (const s of [...this.slots]) this.remove(s.state.id);
  }

  private slot(id: string): Slot {
    const s = this.slots.find((x) => x.state.id === id);
    if (!s) throw new Error(`layer not found: ${id}`);
    return s;
  }

  setOpacity(id: string, opacity: number): void {
    if (this.removed) return;
    const s = this.slot(id);
    s.state.opacity = opacity;
    this.map.setPaintProperty(srcId(id, s.active), "raster-opacity", opacity);
  }

  setVisible(id: string, visible: boolean): void {
    if (this.removed) return;
    const s = this.slot(id);
    s.state.visible = visible;
    this.map.setLayoutProperty(srcId(id, s.active), "visibility", visible ? "visible" : "none");
  }

  /** 配列の先頭が最前面になるよう並べ替える */
  setOrder(ids: string[]): void {
    this.slots.sort((a, b) => ids.indexOf(a.state.id) - ids.indexOf(b.state.id));
    this.reorder();
  }

  private reorder(): void {
    // slots[0] を最前面に：後ろのものから順に OVERLAY_BEFORE_ID の直前へ移動
    const before = this.map.getLayer(OVERLAY_BEFORE_ID) ? OVERLAY_BEFORE_ID : undefined;
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const id = this.slots[i].state.id;
      for (const buf of [0, 1] as const) this.map.moveLayer(srcId(id, buf), before);
    }
    // ↑ i が小さいほど後で移動され before の直前＝上に来る
  }

  /**
   * 表示する日時を変更する。裏のソースで読み込みが終わってから切り替えるため、
   * 返り値の Promise は新しい画像が表示された時点で解決する。
   */
  async setDate(id: string, dateKey: string, timeoutMs = 15000): Promise<void> {
    if (this.removed || !this.has(id)) return;
    const s = this.slot(id);
    if (s.state.dateKey === dateKey) return;
    const ds = getDataset(s.state.datasetKey)!;
    const token = ++s.loadToken;
    const next: 0 | 1 = s.active === 0 ? 1 : 0;
    const nextId = srcId(id, next);
    (this.map.getSource(nextId) as RasterTileSource).setTiles([tileUrl(ds.key, dateKey)]);
    this.map.setPaintProperty(nextId, "raster-opacity", 0);
    this.map.setLayoutProperty(nextId, "visibility", s.state.visible ? "visible" : "none");
    s.state.dateKey = dateKey;
    if (s.state.visible) await waitForSource(this.map, nextId, timeoutMs);
    if (this.removed || token !== s.loadToken || !this.has(id)) return; // 破棄済み、またはより新しい要求が来た
    this.map.setPaintProperty(nextId, "raster-opacity", s.state.opacity);
    const prevId = srcId(id, s.active);
    this.map.setLayoutProperty(prevId, "visibility", "none");
    s.active = next;
  }

  /** 同じ日時で取り直す（エラー後の再読み込み用） */
  reload(): void {
    for (const s of this.slots) {
      const ds = getDataset(s.state.datasetKey)!;
      const src = this.map.getSource(srcId(s.state.id, s.active)) as RasterTileSource | undefined;
      src?.setTiles([tileUrl(ds.key, s.state.dateKey)]);
    }
  }
}
