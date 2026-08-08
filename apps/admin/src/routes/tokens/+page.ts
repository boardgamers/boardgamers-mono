import { api } from "$lib/api.ts";
import type { AdminTokenFront } from "@bgs/models";

export async function load(): Promise<{ tokens: AdminTokenFront[] }> {
	const tokens = await api.get<AdminTokenFront[]>("/admin/tokens").catch(() => []);
	return { tokens };
}
