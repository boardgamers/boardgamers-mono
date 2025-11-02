import adapter from "@sveltejs/adapter-node";
import dotenv from "dotenv";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

dotenv.config();

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter({
      out: "build",
      envPrefix: "BGS_",
    }),
    experimental: {
      remoteFunctions: true,
    },
    alias: {
      $cdk: "src/lib/cdk",
    },
  },

  compilerOptions: {
    experimental: {
      async: true,
    },
  },
};

export default config;
