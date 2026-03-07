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
	eslintConfigPrettier,
	{ ignores: [".svelte-kit/", "build/", "node_modules/"] },
];
