import env from "../config/env.ts";

// LLM auto-translation of CMS page content (#306), backing the admin panel's
// Translate button (routes/admin/pages.ts). Talks to any OpenAI-compatible
// chat-completions API (OpenRouter, Together, …) — the base URL is a fixed,
// operator-configured trusted host, so plain fetch (no safefetch SSRF dance)
// with an abort timeout is the right tool.

export class TranslationError extends Error {
	readonly status: number;
	constructor(message: string, status = 502) {
		super(message);
		this.name = "TranslationError";
		this.status = status;
	}
}

export function isTranslationConfigured(): boolean {
	return env.translation.apiKey !== "";
}

// The product owner's requirement (#306): boardgame names and game-specific
// terms (unit/faction names, …) must survive translation untouched.
const SYSTEM_PROMPT = `You are a professional translator for a board-game platform, translating user-facing markdown pages.
Rules:
- Preserve the markdown formatting and structure exactly: headings, lists, tables, emphasis, code blocks, inline code, and HTML tags stay as-is.
- Do not translate URLs, link targets, image paths, or anchor ids; translate only the human-readable link text.
- Do NOT translate boardgame names, faction/unit names, or other game-specific terminology — keep them exactly as written in the source.
- Translate naturally and idiomatically into the target language.
- Output ONLY the translated text, with no commentary, preamble, or explanation.`;

// Short-UI-label variant of the system prompt (option/setting/preference/
// expansion labels, #306 follow-up): the strings are tiny, so a whole set is
// batched into ONE completion as a JSON object — dozens of per-label calls
// would multiply cost and latency for no quality gain.
const LABELS_SYSTEM_PROMPT = `You are a professional translator for a board-game platform, translating short user-interface labels (game setup options, player settings and preferences, expansion names).
Rules:
- You receive a JSON object mapping stable identifiers to English labels. The identifiers hint at what the label is for (e.g. "options.<name>", "options.<name>.items.<choiceName>", "settings.<name>", "preferences.<name>", "expansions.<name>").
- Respond with ONLY a JSON object: exactly the same keys, each value the translated label. No commentary, no markdown, no code fences.
- Never translate or alter the keys.
- Keep labels short and idiomatic, as befits UI text.
- Do NOT translate boardgame names, faction/unit names, or other game-specific terminology — keep them exactly as written in the source.`;

export interface TranslateMarkdownOptions {
	text: string;
	sourceLang: string;
	targetLang: string;
	// Optional context (e.g. the page name) to orient the model.
	context?: string;
}

interface ChatCompletionsResponse {
	choices?: {
		message?: { content?: string };
		// OpenAI-compatible: "stop" (or "end_turn"/"tool_calls") when done,
		// "length" (some providers: "max_tokens") when the completion was cut
		// off by the token limit.
		finish_reason?: string;
	}[];
	error?: { message?: string };
}

// One chat completion against the configured provider. Throws
// TranslationError (503) when no API key is configured, and (502) on upstream
// errors/timeouts/truncation.
async function chatCompletion(systemPrompt: string, userPrompt: string): Promise<string> {
	if (!isTranslationConfigured()) {
		throw new TranslationError("Translation is not configured on this server (missing translationApiKey)", 503);
	}

	let response: Response;
	try {
		response = await fetch(`${env.translation.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${env.translation.apiKey}`,
			},
			body: JSON.stringify({
				model: env.translation.model,
				temperature: 0.2,
				// Deliberately not sized to the input: reasoning models (e.g. the
				// default gemini-2.5-flash) burn an unpredictable number of
				// thinking tokens before the visible answer, so any input-based
				// estimate eventually truncates (finish_reason "length", surfaced
				// as an error below). This is a low-volume admin endpoint — a flat
				// generous cap only needs to bound a runaway repetition loop.
				max_tokens: 32768,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
			}),
			signal: AbortSignal.timeout(env.translation.timeoutMs),
		});
	} catch (err) {
		throw new TranslationError(`Translation request failed: ${err instanceof Error ? err.message : String(err)}`);
	}

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- untyped upstream JSON; fields are guarded below
	const body = (await response.json().catch(() => null)) as ChatCompletionsResponse | null;
	if (!response.ok) {
		throw new TranslationError(
			`Translation API error (${response.status}): ${body?.error?.message ?? "unknown error"}`,
		);
	}
	const choice = body?.choices?.[0];
	const finishReason = choice?.finish_reason;
	if (finishReason === "length" || finishReason === "max_tokens") {
		// Truncated mid-text — even partial content must not be saved.
		throw new TranslationError("Translation was truncated by the model's token limit — try again or split the page");
	}
	const translated = choice?.message?.content;
	if (typeof translated !== "string" || translated.trim() === "") {
		throw new TranslationError("Translation API returned an empty completion");
	}
	return translated.trim();
}

/**
 * Translate a markdown document from `sourceLang` to `targetLang` via the
 * configured LLM. Throws TranslationError (503) when no API key is configured,
 * and (502) on upstream errors/timeouts.
 */
export async function translateMarkdown({
	text,
	sourceLang,
	targetLang,
	context,
}: TranslateMarkdownOptions): Promise<string> {
	const userPrompt = `Translate the following markdown text from ${sourceLang} to ${targetLang}.${context ? ` Context: this is the "${context}" page of a board-game platform.` : ""}\n\n${text}`;
	return chatCompletion(SYSTEM_PROMPT, userPrompt);
}

export interface TranslateLabelsOptions {
	// key → English label. Keys are the stable overlay identifiers
	// (models/gameinfo-i18n.ts optionSourceStrings).
	labels: Record<string, string>;
	sourceLang: string;
	targetLang: string;
	// e.g. `the board game "Gaia Project"` — shared by every label in the batch.
	context: string;
}

// Labels per completion. Bounds the response size (a runaway/truncated batch
// fails whole) while keeping even option-heavy games to a couple of calls.
const LABEL_BATCH_SIZE = 60;

function labelsUserPrompt(labels: Record<string, string>, sourceLang: string, targetLang: string, context: string) {
	return `Translate the following UI labels from ${sourceLang} to ${targetLang}. They belong to ${context}. Respond with ONLY a JSON object with exactly the same keys and the translated labels as values.\n\n${JSON.stringify(labels)}`;
}

// Parse a (hopefully) JSON completion into key → translated label, keeping
// only entries that match a requested key with a non-empty string value.
// Tolerates the classic LLM decorations (code fences, leading prose before the
// object) — anything else returns null and the caller falls back per string.
function parseLabelsCompletion(completion: string, keys: string[]): Record<string, string> | null {
	const match = /\{[\s\S]*\}/.exec(completion);
	if (!match) {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(match[0]);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return null;
	}
	const out: Record<string, string> = {};
	for (const key of keys) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated object; values are guarded below
		const value = (parsed as Record<string, unknown>)[key];
		if (typeof value === "string" && value.trim() !== "") {
			out[key] = value.trim();
		}
	}
	return out;
}

/**
 * Translate a set of short UI labels in ONE completion per batch of
 * LABEL_BATCH_SIZE (a JSON object in, a JSON object out — response validated
 * per key). Keys the model dropped or mangled are retried individually
 * (per-string fallback), so a flaky batch degrades to the slow path instead of
 * failing; a label that still can't be translated throws (the caller records
 * the pair as errored, nothing partial is lost — fresh entries are kept).
 */
export async function translateLabels({
	labels,
	sourceLang,
	targetLang,
	context,
}: TranslateLabelsOptions): Promise<Record<string, string>> {
	const keys = Object.keys(labels);
	const translated: Record<string, string> = {};
	for (let i = 0; i < keys.length; i += LABEL_BATCH_SIZE) {
		const batchKeys = keys.slice(i, i + LABEL_BATCH_SIZE);
		const batch = Object.fromEntries(batchKeys.map((key) => [key, labels[key]]));
		const completion = await chatCompletion(
			LABELS_SYSTEM_PROMPT,
			labelsUserPrompt(batch, sourceLang, targetLang, context),
		);
		Object.assign(translated, parseLabelsCompletion(completion, batchKeys) ?? {});
	}
	// Per-string fallback for whatever the batches didn't deliver.
	for (const key of keys.filter((k) => !(k in translated))) {
		translated[key] = await translateMarkdown({
			text: labels[key],
			sourceLang,
			targetLang,
			context: `"${key}" game setup label of ${context} (answer with the translated label only)`,
		});
	}
	return translated;
}
