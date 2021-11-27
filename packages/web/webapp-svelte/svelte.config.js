import dotenv from "dotenv";
import path from "path";
import preprocess from "svelte-preprocess";

dotenv.config();

const remote = process.env.backend === "remote";

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
    vite: {
      resolve: {
        alias: {
          // these are the aliases and paths to them
          "@": path.resolve("./src"),
          "@cdk": path.resolve("./src/modules/cdk"),
        },
      },
      server: {
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
    },
  },
};

export default config;
