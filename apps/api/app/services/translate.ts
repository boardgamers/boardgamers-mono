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

export interface TranslateMarkdownOptions {
	text: string;
	sourceLang: string;
	targetLang: string;
	// Optional context (e.g. the page name) to orient the model.
	context?: string;
}

interface ChatCompletionsResponse {
	choices?: { message?: { content?: string } }[];
	error?: { message?: string };
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
	if (!isTranslationConfigured()) {
		throw new TranslationError("Translation is not configured on this server (missing translationApiKey)", 503);
	}

	const userPrompt = `Translate the following markdown text from ${sourceLang} to ${targetLang}.${context ? ` Context: this is the "${context}" page of a board-game platform.` : ""}\n\n${text}`;

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
				// Sized to the input: translations are roughly as long as their
				// source (~4 chars/token); floor for tiny inputs.
				max_tokens: Math.max(1024, Math.ceil(text.length / 2)),
				messages: [
					{ role: "system", content: SYSTEM_PROMPT },
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
	const translated = body?.choices?.[0]?.message?.content;
	if (typeof translated !== "string" || translated.trim() === "") {
		throw new TranslationError("Translation API returned an empty completion");
	}
	return translated.trim();
}
