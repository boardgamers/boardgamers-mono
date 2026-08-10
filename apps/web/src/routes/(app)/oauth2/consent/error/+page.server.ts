import type { PageServerLoad } from "./$types";

// The consent flow lands here when the authorize request itself is broken (missing
// params, unresolvable/forged CIMD document, redirect_uri not registered, …). There
// is no trustworthy client to redirect back to, so this is a terminal error page.
export const load: PageServerLoad = () => ({
	seo: { title: "Authorization error", noindex: true },
});
