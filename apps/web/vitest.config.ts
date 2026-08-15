import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
	plugins: [svelte()],
	define: {
		__APP_RELEASE__: JSON.stringify("test"),
	},
	resolve: {
		conditions: ["browser"],
		alias: {
			"$app/environment": r("./src/lib/__mocks__/app-environment.ts"),
			"$app/navigation": r("./src/lib/__mocks__/app-navigation.ts"),
			"$app/paths": r("./src/lib/__mocks__/app-paths.ts"),
			"$app/state": r("./src/lib/__mocks__/app-state.ts"),
			"@": r("./src"),
			"@cdk": r("./src/modules/cdk"),
			$lib: r("./src/lib"),
		},
	},
	test: {
		// `*.spec.svelte.ts` is a spec that needs runes (`$state` fixtures); both are TS.
		include: ["src/**/*.spec.ts", "src/**/*.spec.svelte.ts"],
		setupFiles: ["./vitest.setup.ts"],
		environment: "jsdom",
	},
});
