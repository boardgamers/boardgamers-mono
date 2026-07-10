import { api } from "$lib/api.ts";

export interface PageData {
	_id: { name: string; lang: string };
	title: string;
	content: string;
}

export async function load({ params }: { params: { name: string; lang: string } }): Promise<{
	value: PageData | null;
}> {
	try {
		const value = await api.get<PageData>(`/admin/page/${params.name}/${params.lang}`);
		return { value };
	} catch {
		return { value: null };
	}
}