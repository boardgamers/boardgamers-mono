import { api } from "$lib/api.ts";
import type { ChangelogFront } from "@bgs/models";

export async function load(): Promise<{ entries: ChangelogFront[] }> {
	const entries = await api.get<ChangelogFront[]>("/admin/changelog").catch(() => []);
	return { entries };
}
