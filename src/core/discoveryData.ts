/**
 * 「今週の地球の発見」：最新の衛星データを取得して、発見の文章を自動で作る。
 * 結果は最新データの日付ごとにキャッシュする（データが更新されると内容も変わる）。
 */
import { PersistentCache } from "./cache";
import { getDataset } from "./datasetRegistry";
import { addDays, addMonths, formatDateJa, toDateKey } from "./dates";
import {
  changeWord,
  extentChange,
  findPeak,
  pairedAreaMeanDiff,
  sumGrids,
  TOKYO_ANNUAL_PRECIP_MM,
  type Grid,
} from "./discoveries";
import { getAvailableRange, getDates, getGlobalGrid, getPolarGrid } from "./jaxaClient";
import { placeLabel } from "./regions";
import { formatNumber } from "./stats";
import type { DatasetDef } from "./types";

export interface Discovery {
  id: string;
  icon: string;
  title: string;
  /** 主役の場所（ある場合） */
  place?: string;
  text: string;
  /** 注意書き（推定値・比較の限界など） */
  note: string;
  /** 使ったデータの日時 */
  dataLabel: string;
  link: string;
}

export interface DiscoveryGenerator {
  id: string;
  icon: string;
  /** 読み込み中に表示する見出し */
  pendingTitle: string;
  /** キャッシュのキーに使うデータセット（最新日時が変わったら作り直す） */
  datasetKey: string;
  run(ds: DatasetDef, last: Date): Promise<Discovery>;
}

const fetchGrid = (ds: DatasetDef, date: Date): Promise<Grid> => getGlobalGrid(ds, date);

const ds = (key: string) => {
  const d = getDataset(key);
  if (!d) throw new Error(`dataset ${key} がありません`);
  return d;
};

const signed = (v: number, digits?: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${formatNumber(Math.abs(v), digits)}`;

// ---------------------------------------------------------------- 1. この1週間の大雨

const weekRain: DiscoveryGenerator = {
  id: "week-rain",
  icon: "☔",
  pendingTitle: "この1週間でいちばん雨が多かった場所",
  datasetKey: "precip-daily",
  async run(d, last) {
    const dates = await getDates(d, addDays(last, -6), last);
    if (dates.length < 3) throw new Error("この1週間のデータが足りません");
    const grids = await Promise.all(dates.map((t) => fetchGrid(d, t)));
    // 日平均の降水強度 (mm/時) × 24 = その日の降水量 (mm)
    const total = sumGrids(grids, 24);
    const peak = findPeak(total, 1, [-60, 60]);
    if (!peak) throw new Error("最大値が見つかりませんでした");
    const place = placeLabel(peak.lon, peak.lat);
    const pct = (peak.value / TOKYO_ANNUAL_PRECIP_MM) * 100;
    const first = dates[0];
    const lastDay = dates[dates.length - 1];
    return {
      id: this.id,
      icon: this.icon,
      title: "この1週間でいちばん雨が多かったのは…",
      place,
      text:
        `${formatDateJa(first, "daily")}〜${formatDateJa(lastDay, "daily")}の${dates.length}日間に、約${formatNumber(peak.value, 0)}mmの雨がふったと推定されます。` +
        `これは東京で1年間にふる雨（平年 約1,600mm）の約${formatNumber(pct, 0)}%にあたります。`,
      note: "衛星からの推定値で、約300km四方の平均です。台風や前線が通った場所かどうか、地図で確かめてみよう。",
      dataLabel: `日別降水量 ${formatDateJa(first, "daily")}〜${formatDateJa(lastDay, "daily")}`,
      link: `#/map?ds=precip-daily&date=${toDateKey(lastDay, "daily")}&c=${peak.lon.toFixed(1)},${peak.lat.toFixed(1)},4`,
    };
  },
};

// ---------------------------------------------------------------- 2. いちばん熱い地面

const hotLand: DiscoveryGenerator = {
  id: "hot-land",
  icon: "🔥",
  pendingTitle: "いちばん地面が熱かった場所",
  datasetKey: "lst",
  async run(d, last) {
    const grid = await fetchGrid(d, last);
    const peak = findPeak(grid, 1, [-60, 70]);
    if (!peak) throw new Error("最大値が見つかりませんでした");
    const c = peak.value + (d.displayOffset ?? 0);
    const month = formatDateJa(last, "monthly");
    return {
      id: this.id,
      icon: this.icon,
      title: `${month}、いちばん地面が熱かったのは…`,
      place: placeLabel(peak.lon, peak.lat),
      text: `昼（午前10時半ごろ）の地面の温度は、${month}の平均で約${formatNumber(c, 0)}℃でした。`,
      note: "気温（空気の温度）ではなく、地面そのものの温度です。雲のない日の観測から作った月平均・約300km四方の平均です。",
      dataLabel: `地表面温度 ${month}`,
      link: `#/map?ds=lst&date=${toDateKey(last, "monthly")}&c=${peak.lon.toFixed(1)},${peak.lat.toFixed(1)},4`,
    };
  },
};

// ---------------------------------------------------------------- 3. 海面水温の前年比較

const seaTemp: DiscoveryGenerator = {
  id: "sea-temp",
  icon: "🌊",
  pendingTitle: "世界の海の温度、去年とくらべると",
  datasetKey: "sst",
  async run(d, last) {
    const prev = addMonths(last, -12);
    const { first } = await getAvailableRange(d);
    if (prev < first) throw new Error("1年前のデータがありません");
    const [a, b] = await Promise.all([fetchGrid(d, prev), fetchGrid(d, last)]);
    const r = pairedAreaMeanDiff(a, b, [-60, 60]);
    if (!r) throw new Error("比較できる場所がありません");
    const word = changeWord(r.diff, 0.05);
    const month = formatDateJa(last, "monthly");
    const prevMonth = formatDateJa(prev, "monthly");
    return {
      id: this.id,
      icon: this.icon,
      title: word === "ほぼ同じ" ? "世界の海の温度は、去年とほぼ同じ" : `世界の海は、去年の同じ月より${word === "高い" ? "あたたかい" : "つめたい"}`,
      text:
        `${month}の海面水温の平均（南緯60°〜北緯60°）は約${formatNumber(r.meanB, 1)}℃で、` +
        `${prevMonth}とくらべて${signed(r.diff, 2)}℃でした。`,
      note:
        `2つの月の両方で雲がなく観測できた場所（海の約${formatNumber(r.coverage * 100, 0)}%）だけでくらべています。` +
        "1年だけの差にはエルニーニョ現象などの年ごとのゆらぎも含まれるため、地球温暖化かどうかはこの比較だけでは判断できません。",
      dataLabel: `海面水温 ${prevMonth} と ${month}`,
      link: `#/timemachine?ds=sst&a=${toDateKey(prev, "monthly")}&b=${toDateKey(last, "monthly")}`,
    };
  },
};

// ---------------------------------------------------------------- 4. 北極の海氷の前年比較

const arcticIce: DiscoveryGenerator = {
  id: "arctic-ice",
  icon: "🧊",
  pendingTitle: "北極の海氷、去年とくらべると",
  datasetKey: "seaice",
  async run(d, last) {
    const prev = new Date(Date.UTC(last.getUTCFullYear() - 1, last.getUTCMonth(), last.getUTCDate()));
    const [a, b] = await Promise.all([getPolarGrid(d, prev), getPolarGrid(d, last)]);
    const r = extentChange(a.data, b.data, 15);
    if (!r) throw new Error("海氷の範囲を計算できませんでした");
    const pct = (r.ratio - 1) * 100;
    const word = changeWord(pct, 1, "広い", "せまい");
    const day = formatDateJa(last, "daily");
    const prevDay = formatDateJa(prev, "daily");
    return {
      id: this.id,
      icon: this.icon,
      title: word === "ほぼ同じ" ? "北極の海氷は、去年の同じ日とほぼ同じ広さ" : `北極の海氷は、去年の同じ日より${word}`,
      text: `${day}の北極で海氷がある範囲（密接度15%以上）は、${prevDay}とくらべて約${signed(pct, 0)}%でした。`,
      note: "地図の格子の数でくらべた、おおよその値です。海氷は毎年9月ごろにいちばん小さく、3月ごろにいちばん大きくなります。長い期間の変化はタイムマシンで確かめよう。",
      dataLabel: `海氷密接度 ${prevDay} と ${day}`,
      link: `#/timemachine?ds=seaice&a=${toDateKey(prev, "daily")}&b=${toDateKey(last, "daily")}`,
    };
  },
};

// ---------------------------------------------------------------- 5. 緑の季節変化

const greenShift: DiscoveryGenerator = {
  id: "green-shift",
  icon: "🌳",
  pendingTitle: "地球の緑は増えた？減った？",
  datasetKey: "ndvi",
  async run(d, last) {
    const prev = addMonths(last, -1);
    const [a, b] = await Promise.all([fetchGrid(d, prev), fetchGrid(d, last)]);
    const north = pairedAreaMeanDiff(a, b, [30, 60]);
    const south = pairedAreaMeanDiff(a, b, [-40, -10]);
    if (!north || !south) throw new Error("比較できる場所がありません");
    const eps = 0.01;
    const nw = changeWord(north.diff, eps, "増えて", "減って");
    const sw = changeWord(south.diff, eps, "増えて", "減って");
    const title =
      nw === "ほぼ同じ" ? "北半球の緑は、先月とあまり変わっていません" : nw === "増えて" ? "北半球で、緑が増えています" : "北半球で、緑が減ってきました";
    let season = "季節の移り変わりや、雨の量のちがいなどが考えられます。";
    if (nw === "減って" && sw === "増えて") season = "北半球は秋から冬へ、南半球は春から夏へ向かう季節であることが考えられます。";
    if (nw === "増えて" && sw === "減って") season = "北半球は春から夏へ、南半球は秋から冬へ向かう季節であることが考えられます。";
    const pm = formatDateJa(prev, "monthly");
    const lm = formatDateJa(last, "monthly");
    const f = (v: number) => formatNumber(v, 2);
    return {
      id: this.id,
      icon: this.icon,
      title,
      text:
        `${pm}から${lm}にかけて、北半球の中緯度（北緯30〜60°）の植生指数は平均 ${f(north.meanA)} → ${f(north.meanB)}、` +
        `南半球（南緯10〜40°）では ${f(south.meanA)} → ${f(south.meanB)} でした。${season}`,
      note: "雲や雪の影響で値が低く出る場所もあります。ほかの年の同じ月とくらべて、今年が特別かどうか調べてみよう。",
      dataLabel: `植生指数 ${pm} と ${lm}`,
      link: `#/timemachine?ds=ndvi&a=${toDateKey(prev, "monthly")}&b=${toDateKey(last, "monthly")}`,
    };
  },
};

export const DISCOVERY_GENERATORS: DiscoveryGenerator[] = [weekRain, hotLand, seaTemp, arcticIce, greenShift];

/** 発見のキャッシュ（同じ最新データなら作り直さない） */
const cache = new PersistentCache<Discovery>(3 * 86400000);
const CACHE_VERSION = "v1";

export async function runDiscovery(g: DiscoveryGenerator): Promise<Discovery> {
  const d = ds(g.datasetKey);
  const { last } = await getAvailableRange(d);
  const key = `disc|${CACHE_VERSION}|${g.id}|${toDateKey(last, d.temporal)}`;
  const hit = await cache.get(key);
  if (hit) return hit;
  const res = await g.run(d, last);
  await cache.set(key, res);
  return res;
}
