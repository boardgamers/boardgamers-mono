import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
	return { seo: { title: "Reset password", noindex: true } };
};
