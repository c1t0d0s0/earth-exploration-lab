import "./styles/tokens.css";
import "./styles/layout.css";
import { startRouter } from "./router";
import { homePage } from "./pages/home";

const root = document.getElementById("app")!;

startRouter(
  root,
  {
    "/": async () => homePage,
    // 地図を使う画面は必要になったときに読み込む（初期表示の高速化）
    "/map": async () => (await import("./pages/explorerMap")).explorerMapPage,
    "/timemachine": async () => (await import("./pages/timeMachine")).timeMachinePage,
    "/lab": async () => (await import("./pages/dataLab")).dataLabPage,
    "/quiz": async () => (await import("./pages/quiz")).quizPage,
    "/ranking": async () => (await import("./pages/ranking")).rankingPage,
    "/satellite": async () => (await import("./pages/satellite")).satellitePage,
  },
  (path, page) => {
    // 地図を使う画面は「ヘッダー＋本体＋フッター」を画面の高さに収める
    const layout = typeof page.layout === "function" ? page.layout() : (page.layout ?? "app");
    document.body.classList.toggle("layout-app", layout === "app");
    document.querySelectorAll<HTMLAnchorElement>(".site-nav a").forEach((a) => {
      const target = a.getAttribute("href")!.replace(/^#/, "").split("?")[0] || "/";
      if (target === path) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  },
);
