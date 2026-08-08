import { browser } from "$app/environment";
import { writable } from "svelte/store";

export type ToastKind = "alert" | "info" | "success";

export type Toast = {
	id: number;
	kind: ToastKind;
	text: string;
};

export type ConfirmRequest = {
	id: number;
	text: string;
	link?: { url: string; label: string };
	resolve: (ok: boolean) => void;
};

export const toasts = writable<Toast[]>([]);
export const confirmRequest = writable<ConfirmRequest | null>(null);

let nextId = 1;
const DURATION = 5000;

function push(kind: ToastKind, text: string) {
	if (!browser) return;
	const id = nextId++;
	toasts.update((all) => [...all, { id, kind, text }]);
	setTimeout(() => dismiss(id), DURATION);
}

export function dismiss(id: number) {
	toasts.update((all) => all.filter((t) => t.id !== id));
}

export const notifier = {
	alert: (text: string) => push("alert", text),
	info: (text: string) => push("info", text),
	success: (text: string) => push("success", text),
	confirm(text: string, link?: { url: string; label: string }): Promise<boolean> {
		if (!browser) return Promise.resolve(false);
		return new Promise<boolean>((resolve) => {
			confirmRequest.set({ id: nextId++, text, link, resolve });
		});
	},
};

export function answerConfirm(ok: boolean) {
	confirmRequest.update((req) => {
		req?.resolve(ok);
		return null;
	});
}
