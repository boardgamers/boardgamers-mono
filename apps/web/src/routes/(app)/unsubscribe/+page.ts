import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
	return { seo: { title: "Unsubscribe", noindex: true } };
};
