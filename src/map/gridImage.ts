import type { Map as MlMap, ImageSource } from "maplibre-gl";
import type { Grid } from "../core/discoveries";
import { loadJe, toColorMapObject } from "../core/jaxaClient";
import type { ColorMapDef } from "../core/types";
import { OVERLAY_BEFORE_ID } from "./mapView";

const MAX_LAT = 85.0511287798066;

/**
 * 等緯度経度の全球格子を、Web メルカトルの画像にして返す。
 * MapLibre の画像ソースは四隅だけで位置を決めるため、緯度方向をメルカトルに変換して描く。
 */
export async function gridToMercatorDataUrl(g: Grid, cm: ColorMapDef, outHeight = 512): Promise<string> {
  const je = await loadJe();
  const colorMap = new je.image.ColorMap(toColorMapObject(cm));
  const canvas = document.createElement("canvas");
  canvas.width = g.width;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(g.width, outHeight);
  const [, s, , n] = g.bbox;
  for (let y = 0; y < outHeight; y++) {
    // 画像の行 → メルカトルの y → 緯度
    const my = Math.PI * (1 - (2 * (y + 0.5)) / outHeight);
    const lat = (Math.atan(Math.sinh(my)) * 180) / Math.PI;
    const j = Math.floor(((n - lat) / (n - s)) * g.height);
    if (j < 0 || j >= g.height) continue;
    for (let i = 0; i < g.width; i++) {
      const v = g.data[i + j * g.width];
      if (!Number.isFinite(v)) continue;
      const c = colorMap.getColor(v);
      const o = (i + y * g.width) * 4;
      img.data[o] = c.r;
      img.data[o + 1] = c.g;
      img.data[o + 2] = c.b;
      img.data[o + 3] = c.a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

const COORDS: [[number, number], [number, number], [number, number], [number, number]] = [
  [-180, MAX_LAT],
  [180, MAX_LAT],
  [180, -MAX_LAT],
  [-180, -MAX_LAT],
];

/** 地図に格子画像を表示（すでにあれば差し替え） */
export function showGridImage(map: MlMap, id: string, url: string, opacity = 0.85): void {
  const src = map.getSource(id) as ImageSource | undefined;
  if (src) {
    src.updateImage({ url, coordinates: COORDS });
    return;
  }
  map.addSource(id, { type: "image", url, coordinates: COORDS });
  map.addLayer(
    { id, type: "raster", source: id, paint: { "raster-opacity": opacity, "raster-resampling": "nearest", "raster-fade-duration": 0 } },
    map.getLayer(OVERLAY_BEFORE_ID) ? OVERLAY_BEFORE_ID : undefined,
  );
}

export function removeGridImage(map: MlMap, id: string): void {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}
