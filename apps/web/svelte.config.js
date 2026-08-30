import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { execSync } from "node:child_process";

// Same release id as vite.config.ts. Used as the app version so stale clients can
// reliably detect a deploy by comparing against /_app/version.json — with the default
// (build timestamp), a cached old version.json can equal the served one and make
// SvelteKit's "reload after failed chunk import" check report a false negative.
// The fallback MUST be deterministic: SvelteKit evaluates this config twice per
// `vite build` (client pass, then server pass) and hashes version.name into the
// `__sveltekit_<hash>` global that ties the hydration payload to the client
// bundle. A per-evaluation value (e.g. Date.now()) gives the two passes
// different hashes and the app crashes at hydration with
// "Cannot read properties of undefined (reading 'data')" — this happened in the
// CI smoke job, where the container has no usable git checkout.
const release =
	process.env.APP_RELEASE ??
	(() => {
		try {
			return execSync("git rev-parse --short HEAD").toString().trim();
		} catch {
			return process.env.npm_package_version ?? "dev";
		}
	})();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	// PoC for #179: allow `await` in component script/markup/$derived, with async SSR
	// (Svelte 5.39.3+ / Kit 2.43+). Experimental — see the investigation report on #179.
	compilerOptions: {
		experimental: {
			async: true,
		},
	},

	kit: {
		adapter: adapter({
			out: process.env.WEB_ADAPTER_OUT ?? "build",
			// Precompress static assets + prerendered pages (.gz/.br next to each file,
			// served by sirv per Accept-Encoding). Already the adapter default — set
			// explicitly so it can't be lost in an adapter upgrade (#127). SSR HTML is
			// NOT compressed here; that's nginx's job (gzip directive, see #127).
			precompress: true,
		}),
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
