/// <reference types="vitest/config" />
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type HtmlTagDescriptor, type Plugin } from "vite";

/**
 * ルートの config.js から GTM_ID（Google Analytics の測定 ID）を読み取る。
 * ファイルが無い・値が取得できない・形式が不正な場合は null を返す。
 */
function readAnalyticsId(): string | null {
  const file = resolve(import.meta.dirname, "config.js");
  if (!existsSync(file)) return null;
  const match = readFileSync(file, "utf8").match(/\bGTM_ID\s*=\s*(["'`])([^"'`]*)\1/);
  const id = match?.[2].trim() ?? "";
  // HTML への埋め込み前に形式を検証する（G-XXXX / GT-XXXX / UA-XXXX-X / AW-XXXX）
  return /^(G|GT|UA|AW)-[A-Z0-9-]+$/i.test(id) ? id : null;
}

/** GTM_ID が取得できた場合のみ Google Analytics (gtag.js) のタグを <head> に挿入する */
function googleAnalytics(): Plugin {
  return {
    name: "google-analytics",
    transformIndexHtml() {
      const id = readAnalyticsId();
      if (!id) return [];
      const tags: HtmlTagDescriptor[] = [
        {
          tag: "script",
          attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${id}` },
          injectTo: "head-prepend",
        },
        {
          tag: "script",
          children:
            "window.dataLayer = window.dataLayer || [];\n" +
            "function gtag(){dataLayer.push(arguments);}\n" +
            "gtag('js', new Date());\n" +
            `gtag('config', '${id}');`,
          injectTo: "head-prepend",
        },
      ];
      return tags;
    },
  };
}

export default defineConfig({
  // GitHub Pages などのサブパスでも動くよう相対パスで出力する
  base: "./",
  plugins: [googleAnalytics()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // .mjs を application/octet-stream で返す静的サーバー（GitHub Pages 等）があり、
        // MapLibre のワーカーが「Failed to load module script」で読めなくなるため .js で出力する
        assetFileNames: (asset) => {
          const name = asset.names?.[0] ?? asset.name ?? "";
          return name.endsWith(".mjs") ? "assets/[name]-[hash].js" : "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
