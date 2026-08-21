import { api } from "$lib/api.ts";

export interface PageData {
	_id: { name: string; lang: string };
	title: string;
	content: string;
}

export async function load({ params }: { params: { name: string; lang: string } }): Promise<{
	value: PageData | null;
	params: { name: string; lang: string };
}> {
	// `params` is returned (not just read from the route) so the page can
	// prefill a blank editor when the page doesn't exist in this language yet
	// (#306 — the sidebar links missing translations here to create them).
	try {
		const value = await api.get<PageData>(`/admin/page/${params.name}/${params.lang}`);
		return { value, params };
	} catch {
		return { value: null, params };
	}
}
