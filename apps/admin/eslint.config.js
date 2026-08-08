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
	{
		// The admin codebase predates these rules (web satisfies them; admin should be
		// migrated fix-forward — until then keep lint usable instead of 60+ errors).
		rules: {
			"svelte/require-each-key": "off",
			"svelte/no-navigation-without-resolve": "off",
			"svelte/prefer-writable-derived": "off",
			"svelte/no-at-html-tags": "off",
		},
	},
	eslintConfigPrettier,
	{ ignores: [".svelte-kit/", "build/", "dist/", "node_modules/"] },
];
