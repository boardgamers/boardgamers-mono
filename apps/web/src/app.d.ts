interface ImportMetaEnv {
	readonly VITE_MESSAGE: string;
	readonly VITE_backend: string;
}

declare global {
	interface ImportMeta {
		readonly env: ImportMetaEnv;
	}
	// Injected by vite.config.ts (`define.__APP_RELEASE__`).
	const __APP_RELEASE__: string;

	namespace App {
		interface Locals {
			ip: string;
			host: string;
			refreshToken: { code: string; expiresAt: number } | null;
			sidebarOpen: boolean | undefined;
			/** Validated IANA timezone from the `tz` cookie, "UTC" when absent. */
			timezone: string;
			/**
			 * Resolved UI language (#306): `lang` cookie → Accept-Language → "en"
			 * in hooks; the root layout server load upgrades it to the logged-in
			 * user's settings.language when present.
			 */
			language: import("@/lib/i18n/locales").Locale;
		}

		interface PageData {
			user?: import("@bgs/models").UserFront | null;
			activeGames?: string[];
		}

		interface Error {
			message: string;
		}
	}
}

export {};
