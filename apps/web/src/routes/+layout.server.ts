import type { LayoutServerLoad } from "./$types";
import { get } from "@/lib/api";
import { parseLanguage } from "@/lib/i18n/language";
import type { UserFront } from "@bgs/models";

export const load: LayoutServerLoad = async ({ locals }) => {
	let user: UserFront | null = null;
	let activeGames: string[] = [];

	// Only when the request presents a session cookie — skips the API roundtrip for anon
	// visitors. `get` resolves the request's event.fetch (via getRequestEvent), inheriting
	// the cookie — request-scoped, no shared token state, no cross-request leak.
	if (locals.refreshToken) {
		user = await get<UserFront | null>("/account").catch(() => null);
		if (user) {
			activeGames = await get<string[]>("/account/active-games").catch(() => []);
		}
	}

	// UI language (#306): hooks resolved cookie → Accept-Language → "en"; the
	// logged-in user's settings.language is the highest-priority layer and only
	// the layout has the user, so it overrides here. locals is updated too so
	// anything reading it after this load (same request) sees the final value.
	// NOTE: <html lang> was already transformed with the hooks value — when the
	// preference differs, the client corrects it + re-stamps the cookie
	// (+layout.ts), so the next SSR paint matches.
	const userLanguage = parseLanguage(user?.settings?.language);
	const language = userLanguage ?? locals.language;
	locals.language = language;

	return {
		user,
		activeGames,
		sidebarOpen: locals.sidebarOpen,
		// Validated in hooks (tz cookie → IANA zone, "UTC" fallback) — serialized
		// to the client so the layout provides the same zone on both sides (#339).
		timezone: locals.timezone,
		language,
		// Cookie presence (validity unknown) — seeds the client's mint gate before the
		// validated `user` is applied (see +layout.ts / api.ts#setClientSessionKnown).
		hasCookie: !!locals.refreshToken,
	};
};
