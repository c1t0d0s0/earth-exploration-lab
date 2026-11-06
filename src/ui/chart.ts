import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { formatNumber, isValid, type Correlation, type Num } from "../core/stats";
import { h } from "./dom";

export interface ChartSeries {
  label: string;
  unit: string;
  color: string;
  /** 日時 (ms) と値 */
  points: { t: number; v: number | null }[];
}

/** 時系列グラフ（最大2系列、左右の別の軸）＋代替テキストのデータ表 */
export function timeSeriesChart(series: ChartSeries[], opts: { height?: number; title?: string } = {}): { el: HTMLElement; destroy: () => void } {
  const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
  const data: uPlot.AlignedData = [
    times.map((t) => t / 1000),
    ...series.map((s) => {
      const m = new Map(s.points.map((p) => [p.t, p.v]));
      return times.map((t) => {
        const v = m.get(t);
        return isValid(v) ? v : null;
      });
    }),
  ];
  const wrap = h("div", { class: "chart" });
  const plotEl = h("div", { class: "chart-plot", role: "img", "aria-label": `${opts.title ?? "時系列グラフ"}。数値はグラフの下の表で確認できます。` });
  wrap.appendChild(plotEl);

  const axisColor = getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim() || "#94a3b8";
  const gridColor = "rgba(148,163,184,0.15)";
  const plot = new uPlot(
    {
      width: Math.max(280, plotEl.clientWidth || 600),
      height: opts.height ?? 240,
      scales: { x: { time: true }, y0: {}, y1: {} },
      series: [
        { label: "日時", value: (_u, v) => (v == null ? "—" : new Date(v * 1000).toISOString().slice(0, 7)) },
        ...series.map((s, i) => ({
          label: `${s.label}（${s.unit}）`,
          stroke: s.color,
          width: 2,
          scale: `y${i}`,
          spanGaps: false,
          points: { show: true, size: 5, fill: s.color },
          value: (_u: uPlot, v: number | null) => (v == null ? "—" : formatNumber(v)),
        })),
      ],
      axes: [
        { stroke: axisColor, grid: { stroke: gridColor } },
        ...series.map((s, i) => ({
          scale: `y${i}`,
          side: i === 0 ? 3 : 1,
          stroke: s.color,
          grid: { show: i === 0, stroke: gridColor },
          label: `${s.label}（${s.unit}）`,
          labelSize: 20,
          size: 56,
          values: (_u: uPlot, vals: number[]) => vals.map((v) => formatNumber(v)),
        })),
      ] as uPlot.Axis[],
      legend: { live: true },
      cursor: { drag: { x: true, y: false } },
    },
    data,
    plotEl,
  );
  const ro = new ResizeObserver(() => {
    const w = plotEl.clientWidth;
    if (w > 0) plot.setSize({ width: w, height: opts.height ?? 240 });
  });
  ro.observe(plotEl);

  wrap.appendChild(
    h(
      "details",
      { class: "data-table" },
      h("summary", null, "数値を表で見る"),
      h(
        "div",
        { class: "table-scroll" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, h("th", { scope: "col" }, "日時"), series.map((s) => h("th", { scope: "col" }, `${s.label}（${s.unit}）`)))),
          h(
            "tbody",
            null,
            times.map((t, i) => h("tr", null, h("th", { scope: "row" }, new Date(t).toISOString().slice(0, 10)), series.map((_, j) => h("td", null, formatNumber(data[j + 1][i] as number | null))))),
          ),
        ),
      ),
    ),
  );
  return {
    el: wrap,
    destroy: () => {
      ro.disconnect();
      plot.destroy();
    },
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function niceExtent(vals: number[]): [number, number] {
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

/** 散布図（2データの関係）＋回帰直線 */
export function scatterPlot(
  xs: Num[],
  ys: Num[],
  labels: string[],
  axis: { x: string; y: string; xColor: string; yColor: string },
  corr: Correlation | null,
): HTMLElement {
  const pts = xs.map((x, i) => [x, ys[i], labels[i]] as const).filter((p): p is [number, number, string] => isValid(p[0]) && isValid(p[1]));
  const W = 360;
  const H = 260;
  const m = { l: 52, r: 12, t: 10, b: 40 };
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "scatter", role: "img" }) as SVGSVGElement;
  root.setAttribute("aria-label", `散布図：横軸 ${axis.x}、縦軸 ${axis.y}、${pts.length} 個の点${corr ? `、相関係数 ${corr.r.toFixed(2)}` : ""}`);
  if (pts.length) {
    const [x0, x1] = niceExtent(pts.map((p) => p[0]));
    const [y0, y1] = niceExtent(pts.map((p) => p[1]));
    const sx = (v: number) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
    const sy = (v: number) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
    root.appendChild(svg("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: "scatter-bg" }));
    for (let i = 0; i <= 4; i++) {
      const vx = x0 + ((x1 - x0) * i) / 4;
      const vy = y0 + ((y1 - y0) * i) / 4;
      const tx = svg("text", { x: sx(vx), y: H - m.b + 14, "text-anchor": "middle", class: "scatter-tick" });
      tx.textContent = formatNumber(vx);
      const ty = svg("text", { x: m.l - 6, y: sy(vy) + 4, "text-anchor": "end", class: "scatter-tick" });
      ty.textContent = formatNumber(vy);
      root.append(tx, ty, svg("line", { x1: m.l, x2: W - m.r, y1: sy(vy), y2: sy(vy), class: "scatter-grid" }));
    }
    if (corr) {
      root.appendChild(svg("line", { x1: sx(x0), y1: sy(corr.slope * x0 + corr.intercept), x2: sx(x1), y2: sy(corr.slope * x1 + corr.intercept), class: "scatter-fit" }));
      // クリップ（範囲外の線は表示しない）
      const clipId = `clip-${Math.random().toString(36).slice(2)}`;
      const cp = svg("clipPath", { id: clipId });
      cp.appendChild(svg("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b }));
      root.prepend(cp);
      root.lastElementChild!.setAttribute("clip-path", `url(#${clipId})`);
    }
    for (const [x, y, lab] of pts) {
      const c = svg("circle", { cx: sx(x), cy: sy(y), r: 4, class: "scatter-pt" });
      const t = svg("title", {});
      t.textContent = `${lab}: ${formatNumber(x)}, ${formatNumber(y)}`;
      c.appendChild(t);
      root.appendChild(c);
    }
  }
  const xl = svg("text", { x: (W + m.l) / 2, y: H - 6, "text-anchor": "middle", class: "scatter-label", fill: axis.xColor });
  xl.textContent = `→ ${axis.x}`;
  const yl = svg("text", { x: 12, y: (H - m.b) / 2, "text-anchor": "middle", class: "scatter-label", transform: `rotate(-90 12 ${(H - m.b) / 2})`, fill: axis.yColor });
  yl.textContent = `→ ${axis.y}`;
  root.append(xl, yl);
  return h("div", { class: "scatter-wrap" }, root as unknown as Node);
}
