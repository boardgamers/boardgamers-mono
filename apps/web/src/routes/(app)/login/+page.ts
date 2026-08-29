import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { account } from "@/lib/account.svelte";
import { redirectLoggedOut } from "@/utils/redirect";
import { m } from "@/lib/i18n/messages";
import { get as $ } from "svelte/store";

export const load: PageLoad = async ({ url, parent }) => {
	// After an auth redirect (e.g. social login), the API has set the session cookie —
	// just load the account (cookie-auth) and bounce away if already logged in.
	// (?refreshToken= handoffs never get here — +page.server.ts exchanges the code
	// server-side and redirects first.)
	if (url.searchParams.has("auth")) {
		const { loadAccount } = await import("@/lib/account.svelte");
		await loadAccount();
	}

	const { user } = await parent();
	if (user ?? $(account)) {
		throw redirect(302, redirectLoggedOut(url));
	}

	return {
		seo: {
			title: "Login",
			description: m.seo_loginDescription(),
			noindex: true,
		},
	};
};
