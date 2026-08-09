import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
	return { seo: { title: "Forgotten password", noindex: true } };
};
