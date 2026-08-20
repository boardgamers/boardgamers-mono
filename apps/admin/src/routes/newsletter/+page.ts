import { api } from "$lib/api.ts";
import type { NewsletterFront } from "@bgs/models";

export interface NewsletterData {
	recipientCount: number;
	newsletters: NewsletterFront[];
}

export async function load(): Promise<NewsletterData> {
	const [count, newsletters] = await Promise.all([
		api.get<{ count: number }>("/admin/newsletter/count").catch(() => ({ count: 0 })),
		api.get<NewsletterFront[]>("/admin/newsletter").catch(() => []),
	]);
	return { recipientCount: count.count, newsletters };
}
