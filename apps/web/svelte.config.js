import adapter from "@sveltejs/adapter-node";
import dotenv from "dotenv";
import path from "path";
import preprocess from "svelte-preprocess";

dotenv.config();

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://github.com/sveltejs/svelte-preprocess
  // for more information about preprocessors
  preprocess: [
    preprocess({
      postcss: true,
    }),
  ],

  kit: {
    target: "body",
    adapter: adapter({ out: "build" }),
    vite: {
      resolve: {
        alias: {
          // these are the aliases and paths to them
          "@": path.resolve("./src"),
          "@cdk": path.resolve("./src/modules/cdk"),
        },
      },
      server: {
        port: "8612",
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
    },
  },
};

export default config;
