import { getDataset, LAB_PRESETS, TIME_MACHINE_PRESETS, WEEKLY_DISCOVERIES } from "../core/datasetRegistry";
import { formatDateJa, isoWeek } from "../core/dates";
import { DISCOVERY_GENERATORS, runDiscovery, type Discovery } from "../core/discoveryData";
import { getAvailableRange, getOverviewCanvas } from "../core/jaxaClient";
import { h, setChildren } from "../ui/dom";
import { renderLegend } from "../ui/legend";
import type { Page } from "./page";

const TODAY_OPTIONS = ["precip", "sst", "ndvi", "lst"];

export const homePage: Page = {
  title: "トップ",
  layout: "doc",
  mount(root) {
    let disposed = false;
    const todayImg = h("div", { class: "today-canvas", role: "img", "aria-label": "最新の全球衛星データ画像" }, h("p", { class: "hint" }, "🛰️ 衛星データを読み込み中…"));
    const todayCaption = h("p", { class: "hint", "aria-live": "polite" });
    const todayLegend = h("div", null);
    const todayTabs = h("div", { class: "segmented", role: "radiogroup", "aria-label": "表示するデータ" });

    async function showToday(key: string) {
      const ds = getDataset(key)!;
      todayTabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.key === key)));
      setChildren(todayImg, h("p", { class: "hint" }, "🛰️ 衛星データを読み込み中…"));
      void renderLegend(todayLegend, ds, { compact: true });
      try {
        // 最新の日時を明示して渡す（省略すると現在時刻が使われ、ライブラリが警告を出す）
        const { last } = await getAvailableRange(ds);
        const { canvas, date } = await getOverviewCanvas(ds, last, 720, 360);
        if (disposed) return;
        canvas.classList.add("today-img");
        setChildren(todayImg, canvas);
        todayImg.setAttribute("aria-label", `${formatDateJa(date, ds.temporal)}の全球${ds.shortName}の画像`);
        setChildren(todayCaption, `${ds.icon} ${ds.name}：${formatDateJa(date, ds.temporal)}（最新）`, " ", h("a", { href: `#/map?ds=${ds.key}` }, "地図でくわしく見る →"));
      } catch (e) {
        setChildren(todayImg, h("p", { class: "error" }, `データを読み込めませんでした：${(e as Error).message}`));
      }
    }
    for (const key of TODAY_OPTIONS) {
      const ds = getDataset(key)!;
      todayTabs.appendChild(h("button", { type: "button", role: "radio", "data-key": key, onclick: () => void showToday(key) }, `${ds.icon} ${ds.shortName}`));
    }

    // ---- 今週の地球の発見：最新データから自動生成（できたものから順に表示）
    const discoveryGrid = h("div", { class: "card-grid", "aria-live": "polite", "aria-busy": "true" });
    const discoveryStatus = h("p", { class: "hint" });
    const cards = DISCOVERY_GENERATORS.map((g) =>
      h("div", { class: "discovery-card pending" },
        h("h3", null, h("span", { "aria-hidden": "true" }, `${g.icon} `), g.pendingTitle),
        h("p", { class: "hint" }, "🛰️ 衛星データを調べています…")),
    );
    cards.forEach((c) => discoveryGrid.appendChild(c));
    const discoveryCard = (d: Discovery) =>
      h("a", { class: "discovery-card", href: d.link },
        h("h3", null, h("span", { "aria-hidden": "true" }, `${d.icon} `), d.title),
        d.place ? h("p", { class: "discovery-place" }, `📍 ${d.place}`) : null,
        h("p", null, d.text),
        h("p", { class: "discovery-note" }, d.note),
        h("p", { class: "discovery-meta" }, `使ったデータ：${d.dataLabel}`),
        h("span", { class: "more" }, d.link.startsWith("#/timemachine") ? "タイムマシンでくらべる →" : "地図で調べてみる →"));
    // 自動生成がすべて失敗したときの固定コンテンツ（週ごとに入れ替え）
    const showFallback = () => {
      const week = isoWeek(new Date());
      const list = [0, 1, 2].map((i) => WEEKLY_DISCOVERIES[(week + i) % WEEKLY_DISCOVERIES.length]);
      setChildren(discoveryGrid, list.map((d) => h("a", { class: "discovery-card", href: d.link }, h("h3", null, d.title), h("p", null, d.text), h("span", { class: "more" }, "調べてみる →"))));
      discoveryStatus.textContent = "最新データを取得できなかったため、おすすめの話題を表示しています。";
    };
    void Promise.allSettled(
      DISCOVERY_GENERATORS.map((g, i) =>
        runDiscovery(g).then(
          (d) => {
            if (!disposed) cards[i].replaceWith(discoveryCard(d));
            return true;
          },
          (e) => {
            console.warn(`[discovery] ${g.id}`, e);
            if (!disposed) cards[i].remove();
            return false;
          },
        ),
      ),
    ).then((rs) => {
      if (disposed) return;
      discoveryGrid.setAttribute("aria-busy", "false");
      if (!rs.some((r) => r.status === "fulfilled" && r.value)) showFallback();
    });

    const feature = (href: string, icon: string, title: string, text: string, ready = true) =>
      h(ready ? "a" : "div", { class: `feature-card${ready ? "" : " disabled"}`, href: ready ? href : null, "aria-disabled": ready ? null : "true" },
        h("span", { class: "feature-icon", "aria-hidden": "true" }, icon),
        h("h3", null, title, ready ? null : h("span", { class: "badge" }, "準備中")),
        h("p", null, text));

    setChildren(
      root,
      h(
        "div",
        { class: "home" },
        h(
          "section",
          { class: "hero" },
          h("div", { class: "hero-earth", "aria-hidden": "true" }),
          h("div", { class: "hero-text" },
            h("p", { class: "hero-kicker" }, "EARTH EXPLORATION LAB"),
            h("h1", null, "宇宙から地球を観察し、", h("br", null), "世界の謎を解き明かそう。"),
            h("p", null, "JAXAの人工衛星が観測した本物のデータで、雨・海・森・氷の変化を、自分の手で調べてみよう。"),
            h("div", { class: "hero-actions" },
              h("a", { class: "btn btn-primary", href: "#/map" }, "🗺️ 地球探検マップをひらく"),
              h("a", { class: "btn", href: "#/lab" }, "🔬 データ実験室へ"))),
        ),
        h("section", { class: "section" },
          h("h2", null, "🌏 今日の地球の姿"),
          h("p", { class: "lead" }, "人工衛星が観測した、いちばん新しい地球のすがたです。"),
          todayTabs, todayImg, todayCaption, todayLegend),
        h("section", { class: "section" },
          h("h2", null, "✨ 今週の地球の発見"),
          h("p", { class: "lead" }, "最新の衛星データから、コンピューターが自動で見つけた発見です。データが更新されると内容も変わります。"),
          discoveryStatus,
          discoveryGrid),
        h("section", { class: "section" },
          h("h2", null, "🧭 探検メニュー"),
          h("div", { class: "card-grid" },
            feature("#/map", "🗺️", "地球探検マップ", "降水量・海面水温・植生などの衛星データを地図で自由に見て、時間を進めてみよう。"),
            feature("#/timemachine", "⏳", "地球タイムマシン", "同じ場所の過去と現在をくらべて、地球の変化を発見しよう。"),
            feature("#/lab", "🔬", "地球データ実験室", "2つのデータを重ねて、グラフで関係を調べ、仮説を確かめよう。"),
            feature("#/quiz", "🕵️", "地球探偵クイズ", "本物の衛星データを調べて、地球の謎を解くミッションに挑戦しよう。"),
            feature("#/ranking", "🏆", "地球データランキング", "雨が多い地域、地面が熱い地域…世界の地域をランキングでくらべよう。"),
            feature("#/satellite", "🛰️", "観測衛星シミュレーター", "人工衛星がどうやって地球を観測しているか、軌道を動かして体験しよう。"))),
        h("section", { class: "section" },
          h("h2", null, "⏳ 地球タイムマシンで見てみよう"),
          h("div", { class: "chip-list" }, TIME_MACHINE_PRESETS.map((p) => h("a", { class: "chip", href: `#/timemachine?preset=${p.id}` }, `${p.icon} ${p.title}`)))),
        h("section", { class: "section" },
          h("h2", null, "💡 おすすめの探究テーマ"),
          h("div", { class: "chip-list" }, LAB_PRESETS.map((p) => h("a", { class: "chip", href: `#/lab?preset=${p.id}` }, `${getDataset(p.a)!.icon}${getDataset(p.b)!.icon} ${p.question}`)))),
      ),
    );
    void showToday(TODAY_OPTIONS[0]);
    return () => {
      disposed = true;
    };
  },
};
