import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { execSync } from "node:child_process";

// Same release id as vite.config.ts. Used as the app version so stale clients can
// reliably detect a deploy by comparing against /_app/version.json — with the default
// (build timestamp), a cached old version.json can equal the served one and make
// SvelteKit's "reload after failed chunk import" check report a false negative.
const release =
	process.env.APP_RELEASE ??
	(() => {
		try {
			return execSync("git rev-parse --short HEAD").toString().trim();
		} catch {
			return Date.now().toString();
		}
	})();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({ out: process.env.WEB_ADAPTER_OUT ?? "build" }),
		alias: {
			"@": "src",
			"@cdk": "src/modules/cdk",
		},
		// No pollInterval: deploys preserve old chunks for 30 days (see deploy.yml), so
		// already-open pages keep working client-side instead of needing a reload.
		version: { name: release },
	},
};

export default config;
