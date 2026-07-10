interface Toast {
	id: number;
	message: string;
	type: "success" | "error" | "info";
}

let nextId = 0;

export const toasts: Toast[] = $state([]);

function add(message: string, type: Toast["type"], duration = 4000) {
	const id = nextId++;
	toasts.push({ id, message, type });
	setTimeout(() => remove(id), duration);
}

function remove(id: number) {
	const idx = toasts.findIndex((t) => t.id === id);
	if (idx !== -1) toasts.splice(idx, 1);
}

export const toast = {
	success: (msg: string) => add(msg, "success"),
	error: (msg: string) => add(msg, "error", 6000),
	info: (msg: string) => add(msg, "info"),
};
