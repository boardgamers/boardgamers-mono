import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

const backend = process.env.VITE_backend ?? "http://127.0.0.1:50801";
const gameplayBackend = process.env.VITE_backend ?? "http://127.0.0.1:50803";
const resourcesBackend = (process.env.VITE_backend ?? "http://127.0.0.1:50804").replace("www.", "resources.");

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 8612,
    proxy: {
      "/ws": {
        target: process.env.VITE_backend ?? "http://127.0.0.1:50802",
        changeOrigin: true,
        ws: true,
      },
      "/api/gameplay": {
        target: gameplayBackend,
        changeOrigin: true,
      },
      "/api": {
        target: backend,
        changeOrigin: true,
      },
      "/resources": {
        target: resourcesBackend,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/resources/, ""),
      },
    },
  },
});
