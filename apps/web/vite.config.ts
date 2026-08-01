import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { execSync } from "node:child_process";

const backend = process.env.VITE_backend ?? "http://127.0.0.1:50801";
const gameplayBackend = process.env.VITE_backend ?? "http://127.0.0.1:50803";
const resourcesBackend = (process.env.VITE_backend ?? "http://127.0.0.1:50804").replace("www.", "resources.");

// Stamp a release id (git SHA, else package version) into the client bundle so error
// reports can be tied to a specific build — invaluable during a migration.
const release =
  process.env.APP_RELEASE ??
  (() => {
    try {
      return execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      return process.env.npm_package_version ?? "dev";
    }
  })();

export default defineConfig({
  define: {
    __APP_RELEASE__: JSON.stringify(release),
  },
  plugins: [tailwindcss(), sveltekit()],
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
