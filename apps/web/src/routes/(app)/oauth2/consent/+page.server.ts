import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { get } from "@/lib/api";
import { loginRedirectQuery } from "@/utils/redirect";

export type ConsentInfo = {
	clientId: string;
	clientName: string;
	clientHost: string;
	logoUri?: string;
	scopes: string[];
};

const REQUIRED_PARAMS = [
	"client_id",
	"redirect_uri",
	"response_type",
	"scope",
	"code_challenge",
	"code_challenge_method",
];

export const load: PageServerLoad = async ({ url, parent }) => {
	if (REQUIRED_PARAMS.some((param) => !url.searchParams.get(param))) {
		throw redirect(303, "/oauth2/consent/error?reason=invalid");
	}

	const { user } = await parent();
	if (!user) {
		throw redirect(303, `/login${loginRedirectQuery(url)}`);
	}

	// The API validates the full request (CIMD fetch, exact redirect match, scopes) —
	// a bad request surfaces as an ApiError here.
	const info = await get<ConsentInfo>(`/oauth2/consent${url.search}`).catch(() => null);
	if (!info) {
		throw redirect(303, "/oauth2/consent/error?reason=invalid");
	}

	return {
		info,
		seo: { title: "Authorize application", noindex: true },
	};
};
