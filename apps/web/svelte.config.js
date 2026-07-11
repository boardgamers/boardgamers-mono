import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter({ out: process.env.WEB_ADAPTER_OUT ?? "build" }),
    alias: {
      "@": "src",
      "@cdk": "src/modules/cdk",
    },
  },
};

export default config;
