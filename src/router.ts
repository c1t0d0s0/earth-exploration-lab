import { claimReload, isChunkLoadError } from "./chunkReload";
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
    let page: Page;
    try {
      page = await load();
    } catch (e) {
      if (my !== seq) return;
      currentPath = null;
      showLoadError(root, e);
      return;
    }
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

  // CSS などの先読みに失敗した場合も同じく最新版へ切り替える（Vite が発行するイベント）
  window.addEventListener("vite:preloadError", (ev) => {
    if (claimReload()) {
      ev.preventDefault();
      location.reload();
    }
  });

  window.addEventListener("hashchange", () => {
    // 同じページ内でもプリセットのリンクを押した場合は作り直す
    const path = (location.hash.replace(/^#/, "").split("?")[0] || "/").replace(/\/$/, "") || "/";
    if (path === currentPath) currentPath = null;
    void render();
  });
  void render();
}

/**
 * ページ用ファイルを読み込めなかったとき。
 * デプロイで古いファイルが消えた可能性が高いので、1回だけ自動で再読み込みして最新版にする。
 */
function showLoadError(root: HTMLElement, e: unknown): void {
  console.warn("[router] ページの読み込みに失敗しました", e);
  if (isChunkLoadError(e) && claimReload()) {
    location.reload();
    return;
  }
  const p = document.createElement("p");
  p.textContent = "ページを読み込めませんでした。サイトが更新された直後か、ネットワークに接続されていない可能性があります。";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary";
  btn.textContent = "再読み込み";
  btn.addEventListener("click", () => location.reload());
  const box = document.createElement("div");
  box.className = "home";
  box.setAttribute("role", "alert");
  const section = document.createElement("section");
  section.className = "section";
  section.append(p, btn);
  box.append(section);
  root.replaceChildren(box);
}
