import { Marker, Popup, type Map as MlMap } from "maplibre-gl";
import { getDataset } from "../core/datasetRegistry";
import { formatDateJa, toDateKey } from "../core/dates";
import { loadProgress, resetProgress, saveProgress } from "../core/progress";
import { DIFFICULTY_LABELS, starsFor, type Mission } from "../core/quiz";
import { evaluateMission, getMission, judgePoint, MISSIONS, resolveDate, type Evaluation } from "../core/quizData";
import { placeLabel } from "../core/regions";
import { formatNumber } from "../core/stats";
import type { DatasetDef } from "../core/types";
import { LayerManager } from "../map/layerManager";
import { createMap, whenStyleLoaded } from "../map/mapView";
import { h, hashQuery, setChildren } from "../ui/dom";
import { renderLegend } from "../ui/legend";
import { mapStatus } from "../ui/mapStatus";
import { describePoint, formatLngLat, wrapLng } from "../ui/pointValue";
import type { Page } from "./page";

const stars = (n: number) => "★".repeat(n) + "☆".repeat(3 - n);

export const quizPage: Page = {
  title: "地球探偵クイズ",
  layout: () => (hashQuery().get("m") ? "app" : "doc"),
  mount(root) {
    const m = getMission(hashQuery().get("m"));
    return m ? mountMission(root, m) : mountList(root);
  },
};

// ================================================================ 一覧

function mountList(root: HTMLElement): () => void {
  let filter: 0 | 1 | 2 | 3 = 0;
  const listEl = h("div", { class: "card-grid" });
  const summaryEl = h("p", { class: "lead" });

  const render = () => {
    const prog = loadProgress();
    const cleared = MISSIONS.filter((m) => prog[m.id]?.cleared).length;
    summaryEl.textContent = `クリアしたミッション：${cleared} / ${MISSIONS.length}`;
    setChildren(
      listEl,
      MISSIONS.filter((m) => !filter || m.difficulty === filter).map((m) => {
        const p = prog[m.id];
        return h(
          "a",
          { class: `mission-card${p?.cleared ? " cleared" : ""}`, href: `#/quiz?m=${m.id}` },
          h("div", { class: "mission-head" },
            h("span", { class: "feature-icon", "aria-hidden": "true" }, m.icon),
            h("span", { class: `badge diff-${m.difficulty}` }, DIFFICULTY_LABELS[m.difficulty]),
            p?.cleared ? h("span", { class: "badge badge-clear" }, "クリア") : null),
          h("h3", null, m.title),
          h("p", null, m.summary),
          p?.cleared ? h("p", { class: "mission-stars", "aria-label": `星${p.stars}つ` }, stars(p.stars)) : h("p", { class: "mission-stars muted" }, "未挑戦・未クリア"),
        );
      }),
    );
  };

  const filterBtns = h(
    "div",
    { class: "segmented", role: "radiogroup", "aria-label": "難易度" },
    ([[0, "すべて"], [1, "かんたん"], [2, "ふつう"], [3, "むずかしい"]] as [0 | 1 | 2 | 3, string][]).map(([v, label]) =>
      h("button", {
        type: "button", role: "radio", "aria-checked": String(v === filter),
        onclick: (e: Event) => {
          filter = v;
          filterBtns.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b === e.currentTarget)));
          render();
        },
      }, label),
    ),
  );

  setChildren(
    root,
    h(
      "div",
      { class: "home" },
      h("section", { class: "section" },
        h("h1", null, "🕵️ 地球探偵クイズ"),
        h("p", { class: "lead" }, "本物の衛星データを調べて、地球の謎を解き明かそう。答えは問題集ではなく、衛星が観測したデータそのものから判定されます。"),
        summaryEl,
        h("div", { class: "row" }, filterBtns,
          h("button", {
            type: "button", class: "btn btn-sm",
            onclick: () => {
              if (confirm("クリアの記録をすべて消しますか？")) {
                resetProgress();
                render();
              }
            },
          }, "記録をリセット"))),
      h("section", { class: "section" }, listEl),
      h("p", { class: "hint" }, "クリアの記録は、このブラウザの中だけに保存されます。"),
    ),
  );
  render();
  return () => {};
}

// ================================================================ ミッション

function mountMission(root: HTMLElement, mission: Mission): () => void {
  let disposed = false;
  let attempts = 0;
  let hintsUsed = 0;
  let finished = false;
  let evaluation: Evaluation | null = null;
  let layerDs: DatasetDef = getDataset(mission.map.layers[0])!;
  let mapDate: Date | null = null;
  let lm: LayerManager | null = null;
  let picked: { lon: number; lat: number; marker: Marker } | null = null;

  // ---------------------------------------------------------------- layout
  const mapEl = h("div", { class: "map" });
  const legendEl = h("div", { class: "legend-mini" });
  const status = mapStatus(() => lm?.reload());
  const layerBtns = h("div", { class: "segmented", role: "radiogroup", "aria-label": "地図のデータ" });
  const dateBtns = h("div", { class: "chip-list" });
  const dateLabel = h("p", { class: "hint", "aria-live": "polite" });
  const hintsEl = h("div", { class: "hints" });
  const answerEl = h("div", { class: "answer" });
  const resultEl = h("div", { class: "result", "aria-live": "assertive" });
  const explainEl = h("div", null);
  const prog = loadProgress()[mission.id];

  setChildren(
    root,
    h(
      "div",
      { class: "page-lab" },
      h("div", { class: "lab-map" }, h("div", { class: "map-wrap" }, mapEl, status.el, h("div", { class: "lab-legends" }, legendEl))),
      h(
        "div",
        { class: "lab-panel" },
        h("p", null, h("a", { href: "#/quiz" }, "← ミッション一覧へ")),
        h("section", { class: "card" },
          h("div", { class: "mission-head" },
            h("span", { class: "feature-icon", "aria-hidden": "true" }, mission.icon),
            h("span", { class: `badge diff-${mission.difficulty}` }, DIFFICULTY_LABELS[mission.difficulty]),
            prog?.cleared ? h("span", { class: "badge badge-clear" }, `クリア済み ${stars(prog.stars)}`) : null),
          h("h1", { class: "panel-title" }, mission.title),
          h("p", { class: "question" }, "❓ ", mission.question),
          h("p", { class: "hint" }, "🔎 ", mission.howTo)),
        h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "① データを調べる"), layerBtns, dateBtns, dateLabel,
          h("p", { class: "hint" }, "地図をクリックすると、その場所の値がわかります。")),
        h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "② ヒント"), hintsEl),
        h("section", { class: "card" }, h("h2", { class: "panel-heading" }, "③ こたえる"), answerEl, resultEl),
        explainEl,
      ),
    ),
  );

  const map: MlMap = createMap(mapEl, { center: mission.map.center, zoom: mission.map.zoom });
  const popup = new Popup({ closeButton: true, maxWidth: "280px" });

  // ---------------------------------------------------------------- map data
  async function showLayer(ds: DatasetDef, date: Date) {
    layerDs = ds;
    mapDate = date;
    layerBtns.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.key === ds.key)));
    dateLabel.textContent = `地図：${ds.icon} ${ds.shortName}・${formatDateJa(date, ds.temporal)}`;
    void renderLegend(legendEl, ds, { compact: true });
    if (!lm) return;
    lm.clear();
    lm.add({ id: "quiz", datasetKey: ds.key, dateKey: toDateKey(date, ds.temporal), opacity: 0.85, visible: true });
  }

  async function initData() {
    const ds0 = getDataset(mission.map.layers[0])!;
    const d0 = await resolveDate(ds0, mission.map.date);
    // データの切りかえボタン（年別データは同じ年を表示）
    setChildren(
      layerBtns,
      mission.map.layers.map((k) => {
        const ds = getDataset(k)!;
        return h("button", {
          type: "button", role: "radio", "data-key": k,
          onclick: async () => showLayer(ds, ds.temporal === "yearly" ? await resolveDate(ds, "2019") : (mapDate ?? d0)),
        }, `${ds.icon} ${ds.shortName}`);
      }),
    );
    if (mission.map.layers.length < 2) layerBtns.hidden = true;
    // 日付の切りかえボタン（選択肢の時期・くらべる時期）
    const c = mission.check;
    const dates = c.type === "extreme-date" ? c.candidates : (mission.datesToShow ?? []);
    setChildren(
      dateBtns,
      dates.map((x) =>
        h("button", { type: "button", class: "chip", onclick: async () => showLayer(layerDs, await resolveDate(layerDs, x.date)) }, `📅 ${x.label}のデータを見る`),
      ),
    );
    await showLayer(ds0, d0);
  }

  // 比較する場所・注目する場所の印
  const c = mission.check;
  const placeMarkers: Marker[] = [];
  if (c.type === "compare-places") {
    for (const p of c.places) {
      const el = h("div", { class: "place-marker" }, `📍${p.name}`);
      placeMarkers.push(new Marker({ element: el, anchor: "bottom" }).setLngLat([p.lon, p.lat]).addTo(map));
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        void inspect(p.lon, p.lat, p.name);
      });
    }
  }
  if (mission.map.marker) {
    placeMarkers.push(new Marker({ color: "#f59e0b" }).setLngLat(mission.map.marker).addTo(map));
  }

  async function inspect(lon: number, lat: number, name?: string) {
    if (!mapDate) return;
    popup.setLngLat([lon, lat]).setText(`${name ?? formatLngLat(lon, lat)}\n読み込み中…`).addTo(map);
    const text = await describePoint(layerDs, mapDate, lon, lat);
    if (popup.isOpen()) popup.setText(`${name ?? formatLngLat(lon, lat)}\n${text}`);
  }

  map.on("click", (e) => {
    const lon = wrapLng(e.lngLat.lng);
    const lat = e.lngLat.lat;
    if (c.type === "find-point" && !finished) {
      // 答えの候補として選ぶ
      picked?.marker.remove();
      const marker = new Marker({ color: "#38bdf8" }).setLngLat([lon, lat]).addTo(map);
      picked = { lon, lat, marker };
      renderAnswer();
    }
    void inspect(lon, lat);
  });

  // ---------------------------------------------------------------- hints
  function renderHints() {
    setChildren(
      hintsEl,
      h("ol", { class: "hint-list" }, mission.hints.slice(0, hintsUsed).map((t) => h("li", null, t))),
      hintsUsed < mission.hints.length
        ? h("button", { type: "button", class: "btn btn-sm", onclick: () => ((hintsUsed++), renderHints()) }, `💡 ヒントを見る（${hintsUsed + 1}/${mission.hints.length}）`)
        : h("p", { class: "hint" }, "ヒントはこれで全部です。"),
    );
  }

  // ---------------------------------------------------------------- answer
  function renderAnswer() {
    if (!evaluation) return;
    if (evaluation.kind === "find-point") {
      setChildren(
        answerEl,
        h("p", null, picked ? `えらんだ場所：${formatLngLat(picked.lon, picked.lat)}` : "👆 地図をクリックして、答えの場所をえらんでください。"),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn btn-primary", disabled: !picked || finished, onclick: () => submitPoint() }, "この場所でこたえる"),
          finished ? null : h("button", { type: "button", class: "btn btn-sm", onclick: () => giveUp() }, "こたえを見る")),
      );
      return;
    }
    const ev = evaluation;
    const name = `ans-${mission.id}`;
    const form = h(
      "form",
      { class: "choices", onsubmit: (e: Event) => (e.preventDefault(), submitChoice(form)) },
      h("fieldset", null,
        h("legend", { class: "sr-only" }, "答えをえらぶ"),
        ev.options.map((o) => h("label", { class: "choice" }, h("input", { type: "radio", name, value: o.key, disabled: finished }), o.label))),
      h("div", { class: "row" },
        h("button", { type: "submit", class: "btn btn-primary", disabled: finished }, "こたえる"),
        finished ? null : h("button", { type: "button", class: "btn btn-sm", onclick: () => giveUp() }, "こたえを見る")),
    );
    setChildren(answerEl, form);
  }

  function submitChoice(form: HTMLFormElement) {
    if (!evaluation || evaluation.kind !== "choice" || finished) return;
    const v = (form.querySelector("input:checked") as HTMLInputElement | null)?.value;
    if (!v) {
      setChildren(resultEl, h("p", { class: "hint" }, "答えをえらんでください。"));
      return;
    }
    attempts++;
    const label = evaluation.options.find((o) => o.key === v)!.label;
    if (evaluation.accepted.includes(v)) finish(true, `「${label}」は正解です！`);
    else setChildren(resultEl, h("p", { class: "wrong" }, `❌ 「${label}」はちがうようです。データをもう一度調べてみよう。`), h("p", { class: "hint" }, `挑戦 ${attempts}回目`));
  }

  function submitPoint() {
    if (!evaluation || evaluation.kind !== "find-point" || !picked || finished) return;
    attempts++;
    const j = judgePoint(evaluation, picked.lon, picked.lat);
    const ds = evaluation.ds;
    const v = j.value == null ? "データなし" : `${formatNumber(j.value + (ds.displayOffset ?? 0))} ${ds.unitLabel}`;
    if (j.correct) {
      finish(true, `${j.place} は上位${formatNumber(Math.max(j.topPct ?? 0, 0.1), 1)}%に入っていました（約300km四方の平均 ${v}）。`);
      return;
    }
    const msg = j.outOfRange
      ? "その場所は判定の範囲外です（緯度が高すぎます）。"
      : j.value == null
        ? "その場所にはデータがありません（雲・海・観測範囲外など）。別の場所をえらぼう。"
        : `${j.place}：約${v}。上位${formatNumber(j.topPct ?? 100, 0)}%なので、まだまだ上があります！`;
    setChildren(resultEl, h("p", { class: "wrong" }, `❌ ${msg}`), h("p", { class: "hint" }, `上位${evaluation.topPercent}%に入る場所をえらぶと正解です。挑戦 ${attempts}回目`));
  }

  function giveUp() {
    if (finished) return;
    finish(false, "こたえを表示します。");
  }

  function finish(correct: boolean, message: string) {
    finished = true;
    const st = starsFor(Math.max(1, attempts), hintsUsed, !correct);
    if (correct) saveProgress(mission.id, { cleared: true, stars: st, attempts, hintsUsed, clearedAt: new Date().toISOString() });
    renderAnswer();
    const ev = evaluation!;
    const facts: (string | Node)[] = [];
    if (ev.kind === "choice") {
      facts.push(`正解：${ev.options.filter((o) => ev.accepted.includes(o.key)).map((o) => o.label).join("、") || "判定できませんでした"}`);
      facts.push(...ev.facts);
    } else {
      const ds = ev.ds;
      facts.push(`最も値が大きかったのは ${placeLabel(ev.peak.lon, ev.peak.lat)}（約300km四方の平均 ${formatNumber(ev.peak.value + (ds.displayOffset ?? 0))} ${ds.unitLabel}）`);
      facts.push(`使ったデータ：${ds.shortName}・${formatDateJa(ev.date, ds.temporal)}`);
      new Marker({ color: "#f43f5e" }).setLngLat([ev.peak.lon, ev.peak.lat]).addTo(map);
      map.flyTo({ center: [ev.peak.lon, ev.peak.lat], zoom: 3 });
    }
    setChildren(
      resultEl,
      correct
        ? h("div", { class: "correct" }, h("p", { class: "correct-title" }, "🎉 ミッションクリア！ ", h("span", { "aria-label": `星${st}つ` }, stars(st))), h("p", null, message))
        : h("p", null, message),
      h("div", { class: "facts" }, h("strong", null, "📊 判定に使ったデータ"), h("ul", null, facts.map((f) => h("li", null, f)))),
    );
    setChildren(
      explainEl,
      h("section", { class: "card" },
        h("h2", { class: "panel-heading" }, "④ 解説"),
        h("p", null, mission.explanation.simple),
        h("details", null, h("summary", null, "くわしい説明"), h("p", { class: "detail" }, mission.explanation.detail)),
        h("p", { class: "caution" }, "⚠️ ", mission.caution),
        h("div", { class: "row" },
          h("a", { class: "btn", href: "#/quiz" }, "ミッション一覧へ"),
          nextMission() ? h("a", { class: "btn btn-primary", href: `#/quiz?m=${nextMission()!.id}` }, "次のミッションへ →") : null)),
    );
  }

  function nextMission(): Mission | undefined {
    const prog2 = loadProgress();
    const i = MISSIONS.indexOf(mission);
    return MISSIONS.slice(i + 1).find((x) => !prog2[x.id]?.cleared) ?? MISSIONS.find((x) => x !== mission && !prog2[x.id]?.cleared);
  }

  // ---------------------------------------------------------------- init
  renderHints();
  setChildren(answerEl, h("p", { class: "hint", role: "status" }, "🛰️ 衛星データから正解を準備しています…"));
  void evaluateMission(mission, (msg) => !evaluation && !disposed && setChildren(answerEl, h("p", { class: "hint", role: "status" }, `🛰️ ${msg}`)))
    .then((ev) => {
      if (disposed) return;
      evaluation = ev;
      renderAnswer();
    })
    .catch((e) => {
      if (!disposed) setChildren(answerEl, h("p", { class: "error", role: "alert" }, `データを取得できませんでした：${(e as Error).message}`), h("button", { type: "button", class: "btn btn-sm", onclick: () => location.reload() }, "もう一度読み込む"));
    });
  void whenStyleLoaded(map).then(() => {
    if (disposed) return;
    lm = new LayerManager(map);
    void initData().catch((e) => (dateLabel.textContent = `地図のデータを読み込めませんでした：${(e as Error).message}`));
  });

  return () => {
    disposed = true;
    status.destroy();
    popup.remove();
    placeMarkers.forEach((x) => x.remove());
    map.remove();
  };
}
