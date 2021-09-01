// vite.config.js
import { svelte } from "@sveltejs/vite-plugin-svelte";
import "dotenv/config";
import preprocess from "svelte-preprocess";
import { defineConfig } from "vite";

const remote = process.env.backend === "remote";

export default defineConfig({
  plugins: [
    svelte({
      preprocess: preprocess({
        postcss: {
          plugins: [require("postcss-nested")],
        },
      }),
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
      "@cdk": "/src/modules/cdk",
    },
  },
  server: {
    open: true,
    proxy: {
      "/ws": {
        target: remote ? "https://www.boardgamers.space" : "http://localhost:50802",
        changeOrigin: true,
        ws: true,
      },
      "/api/gameplay": {
        target: remote ? "https://www.boardgamers.space" : "http://localhost:50803",
        changeOrigin: true,
      },
      "/api": {
        target: remote ? "https://www.boardgamers.space" : "http://localhost:50801",
        changeOrigin: true,
      },
      "/resources": {
        target: remote ? "https://resources.boardgamers.space" : "http://localhost:50804",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/resources/, ""),
      },
    },
  },
});
