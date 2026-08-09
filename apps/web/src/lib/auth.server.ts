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
		// Decode the value before handing it to the cookies API: cookie.serialize encodes
		// on write (default encodeURIComponent), so passing an already-encoded value would
		// double-encode it (breaking later JSON.parse in hooks.server.ts). Koa emits the
		// refreshToken JSON raw today, but can percent-encode depending on config — decode
		// defensively so the browser always stores a single-encoded value.
		let value = pair.slice(eq + 1);
		try {
			value = decodeURIComponent(value);
		} catch {
			// malformed encoding — keep the raw value
		}

		// SvelteKit's cookies API defaults `secure` to true on any non-"localhost" host
		// (e.g. 127.0.0.1), which would drop the session cookie over plain http in dev —
		// so always set it explicitly. The API only sends Secure when it sits behind
		// https; forward the flag only when the browser talks to this server over https.
		const secure = event.url.protocol === "https:";
		const opts: Parameters<typeof event.cookies.set>[2] = { path: "/", secure };
		for (const attr of attrs) {
			const [key, val] = attr.split("=");
			const value = val?.trim(); // valueless attribute (e.g. a bare "SameSite") → undefined
			switch (key.toLowerCase()) {
				case "path":
					if (value) opts.path = value;
					break;
				case "expires":
					if (value) {
						const date = new Date(value);
						if (!Number.isNaN(date.getTime())) opts.expires = date;
					}
					break;
				case "max-age": {
					const maxAge = Number(value);
					if (value !== undefined && !Number.isNaN(maxAge)) opts.maxAge = maxAge;
					break;
				}
				case "httponly":
					opts.httpOnly = true;
					break;
				case "samesite":
					if (value) opts.sameSite = value.toLowerCase() as "lax" | "strict" | "none";
					break;
				case "domain": {
					// Forward the API's Domain only if it covers the host the browser is
					// actually talking to — otherwise the browser would reject the cookie
					// outright (RFC 6265 §5.1.3). On PR previews the API's Domain is the
					// preview host itself (or a sibling for the admin host, where nginx's
					// proxy_cookie_domain rewrite doesn't reach form-action responses), so
					// fall back to host-only when it doesn't cover us.
					const domain = value?.replace(/^\./, "");
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
