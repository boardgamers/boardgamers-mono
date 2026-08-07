import { browser } from "$app/environment";
import { SvelteSet } from "svelte/reactivity";
import { get as getStore } from "svelte/store";
import { currentGameId } from "@/lib/stores.svelte";

// Build-time release id injected by vite.config.ts (declared in app.d.ts).
const release = __APP_RELEASE__;

// Dedupe + throttle: the same error (name+message) is only reported once per session,
// and we cap total reports per session so a flooding error loop can't spam the API.
const seen = new SvelteSet<string>();
let reported = 0;
const MAX_REPORTS = 25;

const ENDPOINT = "/site/errors/report";

function normalize(err: unknown): { name: string; message: string; stack: string[] } {
	if (err instanceof Error) {
		return {
			name: err.name,
			message: err.message,
			stack: (err.stack ?? "").split("\n").slice(0, 30),
		};
	}
	if (typeof err === "string") {
		return { name: "Error", message: err, stack: [] };
	}
	return { name: "Error", message: String((err as { message?: unknown })?.message ?? err), stack: [] };
}

/**
 * Report a client-side error to the backend (stored in the shared apierrors
 * collection, tagged meta.source = "web-client"). Fire-and-forget, deduped and
 * throttled. Safe to call from anywhere; no-ops during SSR.
 */
export function reportError(err: unknown): void {
	if (!browser) {
		return;
	}

	const { name, message, stack } = normalize(err);
	const key = `${name}:${message}`;
	if (seen.has(key) || reported >= MAX_REPORTS) {
		return;
	}
	seen.add(key);
	reported += 1;

	// Raw fetch POST (not the api get/post helpers) so reports work logged-out and
	// never recursively trigger the very error handling we're reporting on.
	fetch(`/api${ENDPOINT}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		keepalive: true,
		body: JSON.stringify({
			name,
			message,
			stack,
			url: window.location.pathname + window.location.search,
			gameId: getStore(currentGameId) ?? undefined,
			release,
		}),
	}).catch(() => {});
}

/** Install global handlers (window.onerror / unhandledrejection). Call once on boot. */
export function initErrorReporting(): void {
	if (!browser) {
		return;
	}
	window.addEventListener("error", (event) => {
		reportError(event.error ?? event.message);
	});
	window.addEventListener("unhandledrejection", (event) => {
		reportError(event.reason);
	});
}
