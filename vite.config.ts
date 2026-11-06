/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages などのサブパスでも動くよう相対パスで出力する
  base: "./",
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
