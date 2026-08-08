import { browser } from "$app/environment";
import type { ChatMessageFront, UserFront } from "@bgs/models";
import { SvelteDate } from "svelte/reactivity";
import { writable, type Writable } from "svelte/store";

/**
 * Per-user/session stores are client-only: they live in module scope, so on the server
 * they're shared across concurrent SSR requests and writing them would leak one request's
 * state into another's render. `clientWritable` wraps a store so ANY mutation (set/update,
 * direct or via a helper) throws during SSR — failing loudly in dev instead of leaking.
 * Reads/subscribes are harmless, so only mutation is guarded.
 */
export function clientWritable<T>(name: string, initial: T): Writable<T> {
	const { subscribe, set, update } = writable<T>(initial);
	const guard = () => {
		if (!browser) {
			throw new Error(`"${name}" is a client-only store and must not be mutated during SSR.`);
		}
	};
	return {
		subscribe,
		set: (v: T) => {
			guard();
			set(v);
		},
		update: (fn: (v: T) => T) => {
			guard();
			update(fn);
		},
	};
}

export function assertBrowserStore(name: string) {
	if (!browser) {
		throw new Error(`"${name}" is a per-user client store and must not be mutated during SSR.`);
	}
}

// --- Account (client-side cache, seeded from $page.data.user) ---

export const account = clientWritable<UserFront | null>("account", null);

export function setAccount(user: UserFront | null) {
	account.set(user);
}

// --- Active games (loaded via +layout.server.ts, maintained by websocket) ---

export const activeGames = clientWritable<string[]>("activeGames", []);

export function addActiveGame(gameId: string) {
	let current = false;
	activeGames.subscribe((games) => {
		current = games.includes(gameId);
	})();
	if (!current) {
		activeGames.update((games) => [...games, gameId]);
	}
}

export function removeActiveGame(gameId: string) {
	activeGames.update((games) => games.filter((g) => g !== gameId));
}

// --- Current game (websocket-maintained, shared across game components) ---

export const currentGameId = clientWritable<string | null>("currentGameId", null);
export const lastGameUpdate = clientWritable<Date>("lastGameUpdate", new SvelteDate(0));
export const playerStatus = clientWritable<Array<{ _id: string; status: "online" | "offline" | "away" }>>(
	"playerStatus",
	[],
);

if (browser) {
	currentGameId.subscribe(() => {
		lastGameUpdate.set(new Date(0));
		playerStatus.set([]);
	});
}

// --- Current room / chat (websocket-maintained) ---

export const room = clientWritable<string | null>("room", null);
export const chatMessages = clientWritable<ChatMessageFront[]>("chatMessages", []);

if (browser) {
	currentGameId.subscribe((val) => room.set(val));
	room.subscribe(() => chatMessages.set([]));
}

// --- Sidebar open (UI state, cookie-backed) ---

import { extractCookie } from "@/utils/extract-cookie";

export const sidebarOpen = writable<boolean>(
	browser ? (extractCookie("sidebarOpen", document.cookie) ?? false) : false,
);

if (browser) {
	sidebarOpen.subscribe((val) => {
		document.cookie = `sidebarOpen=${JSON.stringify(val)}; Path=/; Max-Age=${365 * 10 * 24 * 3600}; SameSite=Lax; Secure`;
	});
}

// --- Logo clicks, developer settings (minor UI state) ---

export const logoClicks = writable<number>(0);
export function logoClick(): void {
	logoClicks.update((n) => n + 1);
}

export type DevGameSettings = {
	viewerUrl: string;
};

export const developerSettings = writable<boolean>(
	browser && JSON.parse(localStorage.getItem("developerSettings") ?? "false"),
);

export const devGameSettings = writable<Record<string, DevGameSettings>>(
	browser ? JSON.parse(localStorage.getItem("devGameSettings") ?? "{}") : {},
);

if (browser) {
	devGameSettings.subscribe((val) => localStorage.setItem("devGameSettings", JSON.stringify(val)));

	developerSettings.subscribe((newVal) => {
		if (newVal) {
			localStorage.setItem("developerSettings", JSON.stringify(newVal));
		} else {
			localStorage.removeItem("developerSettings");
		}
	});
}
