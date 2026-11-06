import { formatDateJa, toDateKey } from "../core/dates";
import type { Temporal } from "../core/types";
import { h, sleep } from "./dom";

export interface TimeControlOptions {
  /** 日時が変わったとき。返り値の Promise が解決（＝表示完了）するまで再生は次に進まない */
  onChange: (date: Date, index: number) => Promise<void> | void;
  label?: string;
}

const SPEEDS = [
  { label: "ゆっくり", ms: 1600 },
  { label: "ふつう", ms: 800 },
  { label: "はやい", ms: 300 },
];

/** 時間軸スライダー＋再生コントロール */
export class TimeControl {
  readonly el: HTMLElement;
  private dates: Date[] = [];
  private temporal: Temporal = "monthly";
  private index = 0;
  private playing = false;
  private playToken = 0;
  private slider: HTMLInputElement;
  private playBtn: HTMLButtonElement;
  private labelEl: HTMLElement;
  private rangeEl: HTMLElement;
  private speed: HTMLSelectElement;
  private loop: HTMLInputElement;
  private status: HTMLElement;

  constructor(private readonly opts: TimeControlOptions) {
    this.slider = h("input", {
      type: "range",
      min: "0",
      max: "0",
      value: "0",
      class: "time-slider",
      "aria-label": opts.label ?? "表示する日時",
      oninput: () => this.go(Number(this.slider.value), true),
    });
    this.playBtn = h("button", { type: "button", class: "btn btn-play", "aria-label": "再生", onclick: () => this.toggle() }, "▶");
    this.labelEl = h("output", { class: "time-label", "aria-live": "polite" }, "—");
    this.rangeEl = h("div", { class: "time-range", "aria-hidden": "true" });
    this.speed = h(
      "select",
      { class: "select-sm", "aria-label": "再生の速さ" },
      SPEEDS.map((s, i) => h("option", { value: String(i), selected: i === 1 }, s.label)),
    );
    this.loop = h("input", { type: "checkbox", checked: true });
    this.status = h("span", { class: "time-status", "aria-live": "polite" });
    this.el = h(
      "div",
      { class: "time-control", role: "group", "aria-label": "時間軸コントロール" },
      h("div", { class: "time-buttons" },
        h("button", { type: "button", class: "btn btn-icon", "aria-label": "最初へ", onclick: () => this.go(0) }, "⏮"),
        h("button", { type: "button", class: "btn btn-icon", "aria-label": "前へ", onclick: () => this.go(this.index - 1) }, "◀"),
        this.playBtn,
        h("button", { type: "button", class: "btn btn-icon", "aria-label": "次へ", onclick: () => this.go(this.index + 1) }, "▶|"),
        h("button", { type: "button", class: "btn btn-icon", "aria-label": "最新へ", onclick: () => this.go(this.dates.length - 1) }, "⏭"),
      ),
      h("div", { class: "time-track" }, this.labelEl, this.slider, this.rangeEl),
      h("div", { class: "time-options" }, this.speed, h("label", { class: "check" }, this.loop, "くり返し"), this.status),
    );
  }

  setDates(dates: Date[], temporal: Temporal, current?: Date): void {
    this.stop();
    this.dates = dates;
    this.temporal = temporal;
    this.slider.max = String(Math.max(0, dates.length - 1));
    let idx = dates.length - 1;
    if (current) {
      const key = toDateKey(current, temporal);
      const found = dates.findIndex((d) => toDateKey(d, temporal) === key);
      if (found >= 0) idx = found;
      else {
        // 指定日時以前で最も近いもの
        const before = dates.filter((d) => d <= current);
        idx = before.length ? dates.indexOf(before[before.length - 1]) : 0;
      }
    }
    this.index = Math.max(0, idx);
    this.slider.value = String(this.index);
    this.slider.disabled = dates.length < 2;
    this.playBtn.disabled = dates.length < 2;
    this.rangeEl.textContent = dates.length ? `${formatDateJa(dates[0], temporal)} 〜 ${formatDateJa(dates[dates.length - 1], temporal)}（${dates.length}コマ）` : "この期間にデータがありません";
    this.updateLabel();
  }

  current(): Date | undefined {
    return this.dates[this.index];
  }

  private updateLabel() {
    const d = this.dates[this.index];
    this.labelEl.textContent = d ? formatDateJa(d, this.temporal) : "—";
    this.slider.setAttribute("aria-valuetext", this.labelEl.textContent);
  }

  async go(i: number, fromSlider = false): Promise<void> {
    if (!this.dates.length) return;
    const n = this.dates.length;
    const idx = Math.min(n - 1, Math.max(0, i));
    if (!fromSlider && idx === this.index) return;
    this.index = idx;
    this.slider.value = String(idx);
    this.updateLabel();
    await this.opts.onChange(this.dates[idx], idx);
  }

  toggle(): void {
    if (this.playing) this.stop();
    else void this.play();
  }

  async play(): Promise<void> {
    if (this.dates.length < 2) return;
    this.playing = true;
    const token = ++this.playToken;
    this.playBtn.textContent = "⏸";
    this.playBtn.setAttribute("aria-label", "一時停止");
    if (this.index >= this.dates.length - 1) await this.go(0);
    while (this.playing && token === this.playToken) {
      const t0 = performance.now();
      await sleep(SPEEDS[Number(this.speed.value)].ms);
      if (!this.playing || token !== this.playToken) break;
      let next = this.index + 1;
      if (next >= this.dates.length) {
        if (!this.loop.checked) break;
        next = 0;
      }
      this.status.textContent = "読み込み中…";
      await this.go(next);
      this.status.textContent = performance.now() - t0 > 4000 ? "通信に時間がかかっています" : "";
    }
    if (token === this.playToken) this.stop();
  }

  stop(): void {
    this.playing = false;
    this.playToken++;
    this.playBtn.textContent = "▶";
    this.playBtn.setAttribute("aria-label", "再生");
    this.status.textContent = "";
  }
}
