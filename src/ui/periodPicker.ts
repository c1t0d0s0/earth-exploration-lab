import { inputTypeFor, parseDateKey, toDateKey } from "../core/dates";
import type { Temporal } from "../core/types";
import { h } from "./dom";

/** 日付入力（月別: type=month、日別: type=date、年別: type=number） */
export function dateInput(temporal: Temporal, value: Date, min: Date, max: Date, label: string, onChange: (d: Date) => void): HTMLInputElement {
  const type = inputTypeFor(temporal);
  const input = h("input", {
    type,
    class: "input",
    "aria-label": label,
    value: toDateKey(value, temporal),
    min: toDateKey(min, temporal),
    max: toDateKey(max, temporal),
    step: type === "number" ? "1" : null,
  });
  input.addEventListener("change", () => {
    if (!input.value) return;
    try {
      let d = parseDateKey(input.value);
      if (d < min) d = min;
      if (d > max) d = max;
      input.value = toDateKey(d, temporal);
      onChange(d);
    } catch {
      input.value = toDateKey(value, temporal);
    }
  });
  return input;
}

export interface PeriodPickerHandle {
  el: HTMLElement;
  get(): { start: Date; end: Date };
}

/** 表示期間（開始〜終了）の指定 */
export function periodPicker(
  temporal: Temporal,
  start: Date,
  end: Date,
  min: Date,
  max: Date,
  onChange: (start: Date, end: Date) => void,
): PeriodPickerHandle {
  let s = start;
  let e = end;
  const fire = () => {
    if (s > e) [s, e] = [e, s];
    onChange(s, e);
  };
  const a = dateInput(temporal, s, min, max, "期間の開始", (d) => ((s = d), fire()));
  const b = dateInput(temporal, e, min, max, "期間の終了", (d) => ((e = d), fire()));
  return {
    el: h("div", { class: "period-picker", role: "group", "aria-label": "表示期間" }, h("span", { class: "field-label" }, "期間"), a, h("span", null, "〜"), b),
    get: () => ({ start: s, end: e }),
  };
}
