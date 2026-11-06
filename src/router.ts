import type { Page } from "./pages/page";

export type Routes = Record<string, () => Promise<Page>>;

/** ハッシュルーター（静的ホスティングでも動くよう #/path を使う） */
export function startRouter(root: HTMLElement, routes: Routes, onNavigate?: (path: string, page: Page) => void): void {
  let cleanup: (() => void) | null = null;
  let currentPath: string | null = null;
  let seq = 0;

  const render = async () => {
    const path = (location.hash.replace(/^#/, "").split("?")[0] || "/").replace(/\/$/, "") || "/";
    if (path === currentPath) return; // クエリだけの変更ではページを作り直さない
    currentPath = path;
    const my = ++seq;
    const load = routes[path] ?? routes["/"];
    const page = await load();
    if (my !== seq) return;
    cleanup?.();
    cleanup = null;
    root.replaceChildren();
    document.title = `${page.title} | 地球探検ラボ`;
    cleanup = page.mount(root);
    onNavigate?.(path, page);
    root.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  };

  window.addEventListener("hashchange", () => {
    // 同じページ内でもプリセットのリンクを押した場合は作り直す
    const path = (location.hash.replace(/^#/, "").split("?")[0] || "/").replace(/\/$/, "") || "/";
    if (path === currentPath) currentPath = null;
    void render();
  });
  void render();
}
