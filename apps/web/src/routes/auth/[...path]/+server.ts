import type { RequestHandler } from "./$types";
import { logEvent } from "@bgs/utils/log";
import { backendUrl } from "@/lib/backend-url.server";
import { requestContextStorage } from "../../../hooks.server";

// Social-OAuth start + callback are api routes mounted at the top-level /auth
// (#248/#307). nginx only routes /api/* to the api, so the web app proxies /auth/*
// itself: full navigations pass through here with the api's redirects and Set-Cookie
// intact. Any failure lands on /login?error=… (rendered as a friendly alert there)
// instead of a bare 404 or a raw JSON error blob.

const MAX_ERROR_LENGTH = 200;

function loginRedirect(message: string): Response {
	return new Response(null, {
		status: 303,
		headers: {
			location: `/login?error=${encodeURIComponent(message.slice(0, MAX_ERROR_LENGTH))}`,
			"cache-control": "no-store",
		},
	});
}

export const GET: RequestHandler = async ({ params, url, request, getClientAddress }) => {
	const target = `${backendUrl(import.meta.env.VITE_backend_api, 50801)}/auth/${params.path}${url.search}`;

	// Build the upstream header set explicitly — never copy the client's headers, so
	// spoofable x-forwarded-* / cf-* never reach the api (same rule as handleFetch in
	// hooks.server.ts). The cookie enables account-linking when already logged in; the
	// x-forwarded-proto/host pair is what the api (app.proxy = true) derives the
	// provider callback URL and post-auth redirect origin from.
	const headers = new Headers();
	const cookie = request.headers.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}
	headers.set("x-forwarded-proto", url.protocol.replace(/:$/, ""));
	headers.set("x-forwarded-host", url.host);
	try {
		headers.set("x-forwarded-for", getClientAddress());
	} catch {
		// No client address available — the api falls back to the socket peer.
	}
	const ctx = requestContextStorage.getStore();
	if (ctx) {
		headers.set("x-request-id", ctx.requestId);
	}

	let upstream: Response;
	try {
		upstream = await fetch(target, { headers, redirect: "manual" });
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		logEvent("error", "auth-proxy", {
			source: "web",
			path: url.pathname,
			requestId: ctx?.requestId,
			error: detail,
		});
		return loginRedirect(`Social login failed: could not reach the auth service (${detail})`);
	}

	const location = upstream.headers.get("location");
	if (upstream.status >= 300 && upstream.status < 400 && location) {
		// Pass the api's redirect through untouched: to the provider on start; back to
		// /account, /signup?ticket=… or /login?error=… on callback — with the session
		// Set-Cookie when the callback logged the user in.
		const responseHeaders = new Headers({ location, "cache-control": "no-store" });
		for (const setCookie of upstream.headers.getSetCookie()) {
			responseHeaders.append("set-cookie", setCookie);
		}
		return new Response(null, { status: upstream.status, headers: responseHeaders });
	}

	// Anything else is an api error (unknown provider, expired/bad OAuth state, provider
	// denial, …), rendered by the api's error handler as JSON { message } — surface that
	// message on the login page. (Provider-side OAuth errors never reach here as HTTP
	// bodies: the api converts them — RFC 6749 §4.1.2.1 callback params become thrown
	// errors, so { message } is the only shape this proxy sees.)
	let message = `Social login failed (HTTP ${upstream.status})`;
	try {
		const body = (await upstream.json()) as { message?: unknown };
		if (typeof body.message === "string" && body.message) {
			message = body.message;
		}
	} catch {
		// Non-JSON body — keep the status-based message.
	}
	logEvent(upstream.status >= 500 ? "error" : "warn", "auth-proxy", {
		source: "web",
		path: url.pathname,
		status: upstream.status,
		requestId: ctx?.requestId,
		message,
	});
	return loginRedirect(message);
};
