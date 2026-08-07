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
			"@": r("./src"),
			"@cdk": r("./src/modules/cdk"),
			$lib: r("./src/lib"),
		},
	},
	test: {
		include: ["src/**/*.spec.ts"],
		setupFiles: ["./vitest.setup.ts"],
		environment: "jsdom",
	},
});
