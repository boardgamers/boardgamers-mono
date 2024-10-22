import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 8612,
    proxy: {
      "/ws": {
        target: process.env.VITE_backend ?? "http://localhost:50802",
        changeOrigin: true,
        ws: true,
      },
      "/api/gameplay": {
        target: process.env.VITE_backend ?? "http://localhost:50803",
        changeOrigin: true,
      },
      "/api": {
        target: process.env.VITE_backend ?? "http://localhost:50801",
        changeOrigin: true,
      },
      "/resources": {
        target: (process.env.VITE_backend ?? "http://localhost:50804").replace("www.", "resources."),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/resources/, ""),
      },
    },
  },
});
