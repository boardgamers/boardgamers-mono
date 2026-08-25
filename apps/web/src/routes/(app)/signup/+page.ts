import type { PageLoad } from "./$types";
import { m } from "@/lib/i18n/messages";

export const load: PageLoad = () => {
	return {
		seo: {
			title: "Create an account",
			description: m.seo_signupDescription(),
		},
	};
};
