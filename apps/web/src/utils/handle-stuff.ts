import { browser } from "$app/environment";
import { isPromise } from "@bgs/utils";
import { notifier } from "@/lib/notifications.svelte";
import { reportError } from "@/lib/report-error.svelte";

// Some API error messages embed a machine timestamp (e.g. the chat-mute 403:
// "…muted until 2026-09-06T21:26:23.386Z"). Localize it for the toast — the raw
// error (kept for console/reporting) stays untouched.
const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/g;

export function humanizeIsoTimestamps(text: string): string {
	return text.replace(ISO_TIMESTAMP, (iso) => {
		const date = new Date(iso);
		return Number.isNaN(date.getTime())
			? iso
			: date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
	});
}

export function handleError(err: Error | string | unknown): void {
	if (!err || !browser) {
		return;
	}

	console.error(err);
	reportError(err);

	if (typeof err === "string") {
		notifier.alert(humanizeIsoTimestamps(err));
	} else if ("message" in (err as any)) {
		notifier.alert(humanizeIsoTimestamps(String((err as any).message)));
	} else {
		notifier.alert("Unknown error");
	}
}

export function handleInfo(info: string): void {
	notifier.info(info);
}

export function handleSuccess(info: string): void {
	notifier.success(info);
}

export function confirm(text: string, link?: { url: string; label: string }): Promise<boolean> {
	return notifier.confirm(text, link);
}

/**
 * Creates a function that will execute the target function, handle thrown error, and finally
 * execute `callback`
 *
 * @param target Function to wrap
 * @param callback Callback to always execute at the end
 * @returns wrapped function
 */
export function defer(target: (...args: any[]) => any, callback?: () => unknown) {
	return (...args: any[]) => {
		try {
			const res = target(...args);

			if (isPromise(res)) {
				return res.catch(handleError).finally(() => callback?.());
			}
		} catch (err) {
			handleError(err as Error);
		} finally {
			callback?.();
		}
	};
}
