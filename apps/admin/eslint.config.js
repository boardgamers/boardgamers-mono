import eslintPluginSvelte from "eslint-plugin-svelte";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { sourceType: "module", ecmaVersion: "latest" },
		},
		plugins: { "@typescript-eslint": tseslint },
		rules: {
			...tseslint.configs.recommended.rules,
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
			// Runtime imports of the @bgs/models root pull mongodb into the browser
			// bundle (root → helpers.ts → mongodb) and crash hydration in prod — import
			// from a subpath (e.g. @bgs/models/locale) or use `import type` (erased at
			// build time, safe). `allowTypeImports` keeps type-only imports allowed.
			"no-restricted-imports": ["error", { paths: [{ name: "@bgs/models", allowTypeImports: true }] }],
		},
	},
	...eslintPluginSvelte.configs["flat/recommended"],
	{
		// flat/recommended parses .svelte files with svelte-eslint-parser but leaves the
		// <script> to espree; delegate it (and .svelte.ts modules) to the TS parser so
		// Svelte 5 runes + TS parse. Must come after the **/*.ts block, which would
		// otherwise override the parser for *.svelte.ts files.
		files: ["**/*.svelte", "**/*.svelte.ts"],
		languageOptions: {
			parserOptions: {
				parser: tsparser,
				sourceType: "module",
				ecmaVersion: "latest",
			},
		},
	},
	eslintConfigPrettier,
	{ ignores: [".svelte-kit/", "build/", "dist/", "node_modules/"] },
];
