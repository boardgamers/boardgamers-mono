/**
 * Compiles apps/web/messages/<locale>.json into the paraglide runtime +
 * per-locale message modules (src/lib/paraglide/, gitignored).
 *
 * Why not `paraglideVitePlugin` / `compile()`? Both load a `project.inlang`
 * directory through the message-format plugin, which the SDK imports from a
 * jsdelivr URL — a network dependency in every dev-server start and CI build.
 * Instead we feed the JSON files straight into `compileProject()` via an
 * in-memory project: no network, and the supported-locale list stays in ONE
 * place (src/lib/i18n/locales.ts) instead of being duplicated in project
 * settings. Runs as a vite `buildStart` hook (see vite.config.ts), which also
 * covers watch mode on message-file edits.
 *
 * Output structure is `locale-modules` (one module per locale) so the client
 * can lazy-load a non-active locale as a single dynamic-import chunk when the
 * user switches language (see src/lib/i18n/messages.ts).
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultLocale, locales } from "../src/lib/i18n/locales.ts";

const require = createRequire(import.meta.url);
// @inlang/sdk is a dependency of @inlang/paraglide-js (not a direct one of
// @bgs/web), so resolve it through paraglide's own package — pnpm's strict
// node_modules layout doesn't hoist it to the app.
const paraglideEntry = require.resolve("@inlang/paraglide-js");
// require.resolve returns a filesystem path; on Windows that is a bare drive path
// ("C:\...") and import() rejects it with ERR_UNSUPPORTED_ESM_URL_SCHEME.
const sdk = await import(pathToFileURL(require.resolve("@inlang/sdk", { paths: [paraglideEntry] })).href);
const paraglide = await import(pathToFileURL(paraglideEntry).href);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(root, "src/lib/paraglide");

type PatternPart =
	| { type: "text"; value: string }
	| { type: "expression"; arg: { type: "variable-reference"; name: string } };

/** "Hello {name}!" → paraglide message-format pattern parts. */
function parsePattern(value: string): PatternPart[] {
	const parts: PatternPart[] = [];
	const re = /\{(\w+)\}/g;
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = re.exec(value))) {
		if (match.index > last) {
			parts.push({ type: "text", value: value.slice(last, match.index) });
		}
		parts.push({ type: "expression", arg: { type: "variable-reference", name: match[1] } });
		last = match.index + match[0].length;
	}
	if (last < value.length) {
		parts.push({ type: "text", value: value.slice(last) });
	}
	return parts;
}

function declarationsFor(value: string) {
	return [...value.matchAll(/\{(\w+)\}/g)].map((m) => ({ type: "input-variable", name: m[1] }));
}

const messagesByLocale = new Map<string, Record<string, string>>();
for (const locale of locales) {
	const raw = await readFile(path.join(root, "messages", `${locale}.json`), "utf8");
	messagesByLocale.set(locale, JSON.parse(raw));
}
const baseMessages = messagesByLocale.get(defaultLocale)!;

const blob = await sdk.newProject({
	settings: {
		$schema: "https://inlang.com/schema/project-settings",
		baseLocale: defaultLocale,
		locales: [...locales],
		modules: [],
	},
});
const project = await sdk.loadProjectInMemory({ blob });

for (const [id, enValue] of Object.entries(baseMessages)) {
	await sdk.insertBundleNested(project.db, {
		id,
		declarations: declarationsFor(enValue),
		messages: [...locales].map((locale) => ({
			locale,
			// Missing translations fall back to the base message so a work-in-progress
			// locale never renders a raw key (the completeness spec forbids this in CI).
			variants: [{ matches: [], pattern: parsePattern(messagesByLocale.get(locale)?.[id] ?? enValue) }],
		})),
	});
}

const output = await paraglide.compileProject({
	project,
	projectPath: "./project.inlang",
	compilerOptions: {
		// The locale decision is owned by our resolution chain (src/lib/i18n/language.ts),
		// not by paraglide strategies: SSR reads it from locals via AsyncLocalStorage,
		// the client sets it explicitly on switch. baseLocale is the final fallback.
		strategy: ["globalVariable", "baseLocale"],
		outputStructure: "locale-modules",
		emitTsDeclarations: true,
		emitGitIgnore: true,
		emitPrettierIgnore: true,
		emitReadme: false,
	},
});

for (const [name, content] of Object.entries(output)) {
	const filePath = path.join(outdir, name);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, content);
}
await project.close?.();

console.log(
	`[i18n] compiled ${Object.keys(baseMessages).length} messages for ${locales.join(", ")} → src/lib/paraglide`,
);
