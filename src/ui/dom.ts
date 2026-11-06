type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

/** 小さな DOM 生成ヘルパー。文字列はテキストノードとして挿入される（XSS 対策） */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === "class") el.className = String(v);
      else if (k in el && !k.includes("-") && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setChildren(el: Element, ...children: (Child | Child[])[]): void {
  clear(el);
  append(el, children);
}

/** URL ハッシュのクエリ (#/map?ds=x&date=y) */
export function hashQuery(): URLSearchParams {
  const h = location.hash;
  const i = h.indexOf("?");
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : "");
}

/** 履歴を増やさずにハッシュのクエリを更新する（共有用 URL） */
export function replaceHashQuery(params: Record<string, string | null | undefined>): void {
  const h = location.hash || "#/";
  const path = h.split("?")[0];
  const q = hashQuery();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  history.replaceState(null, "", `${location.pathname}${location.search}${path}${s ? `?${s}` : ""}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

let idSeq = 0;
export const uid = (p = "id") => `${p}-${++idSeq}`;
