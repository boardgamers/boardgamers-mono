import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import dotenv from "dotenv";

dotenv.config();

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://kit.svelte.dev/docs/integrations#preprocessors
  // for more information about preprocessors
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter({ out: "build" }),
    alias: {
      // these are the aliases and paths to them
      "@": "./src",
      "@cdk": "./src/modules/cdk",
    },
  },
};

export default config;
