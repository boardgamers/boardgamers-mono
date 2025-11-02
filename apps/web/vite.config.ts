import { sveltekit } from "@sveltejs/kit/vite";
// import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  plugins: [/*tailwindcss(),*/ sveltekit()],
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
