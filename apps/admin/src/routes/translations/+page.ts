import { loadTranslationsOverview, type TranslationsOverview } from "$lib/api.ts";

export async function load(): Promise<{ overview: TranslationsOverview | null }> {
	const overview = await loadTranslationsOverview().catch(() => null);
	return { overview };
}
