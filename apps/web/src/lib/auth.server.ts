import type { RequestEvent } from "@sveltejs/kit";

/**
 * Relay the API's session-cookie response (login/logout) to the browser.
 *
 * The web app has no session of its own — the `refreshToken` cookie is minted and
 * cleared by the API, whose domain logic (host-only on localhost/IPs, domain-scoped
 * in prod — see apps/api/app/models/session.ts) matches the web host by design.
 * Server-side API calls (`event.fetch` through `handleFetch`) don't expose upstream
 * set-cookie headers to the browser, so no-JS form actions relay them explicitly via
 * the cookies API (setHeaders forbids set-cookie).
 */
export function forwardSessionCookies(event: RequestEvent, response: Response) {
	for (const header of response.headers.getSetCookie()) {
		// Minimal parse: "name=value; attr=val; …" — the API sets JSON values, no
		// quoted strings or embedded semicolons to worry about.
		const [pair, ...attrs] = header.split(";").map((part) => part.trim());
		const eq = pair.indexOf("=");
		if (eq === -1) continue;
		const name = pair.slice(0, eq);
		const value = pair.slice(eq + 1);

		// SvelteKit's cookies API defaults `secure` to true on any non-"localhost" host
		// (e.g. 127.0.0.1), which would drop the session cookie over plain http in dev —
		// so always set it explicitly. The API only sends Secure when it sits behind
		// https; forward the flag only when the browser talks to this server over https.
		const secure = event.url.protocol === "https:";
		const opts: Parameters<typeof event.cookies.set>[2] = { path: "/", secure };
		for (const attr of attrs) {
			const [key, val] = attr.split("=");
			switch (key.toLowerCase()) {
				case "path":
					opts.path = val;
					break;
				case "expires":
					opts.expires = new Date(val);
					break;
				case "max-age":
					opts.maxAge = Number(val);
					break;
				case "httponly":
					opts.httpOnly = true;
					break;
				case "samesite":
					opts.sameSite = val.toLowerCase() as "lax" | "strict" | "none";
					break;
				case "domain": {
					// Forward the API's Domain only if it covers the host the browser is
					// actually talking to — otherwise the browser would reject the cookie
					// outright (RFC 6265 §5.1.3). On PR previews the API's Domain is the
					// preview host itself (or a sibling for the admin host, where nginx's
					// proxy_cookie_domain rewrite doesn't reach form-action responses), so
					// fall back to host-only when it doesn't cover us.
					const domain = val?.replace(/^\./, "");
					if (domain && (event.url.hostname === domain || event.url.hostname.endsWith(`.${domain}`))) {
						opts.domain = domain;
					}
					break;
				}
			}
		}
		event.cookies.set(name, value, opts);
	}
}
