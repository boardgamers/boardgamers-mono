import { isHttpError } from "@sveltejs/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, clearMintedTokens, mintToken, setClientSessionKnown, toKitError } from "./api";

function catchThrown(fn: () => never): { status: number; message: string } {
	try {
		fn();
	} catch (err) {
		if (isHttpError(err)) {
			return { status: err.status, message: err.body.message };
		}
		throw err;
	}
	throw new Error("expected toKitError to throw");
}

// toKitError is what keeps an api failure inside a `load` from becoming a generic 500:
// the api's status must reach the rendered error page unchanged.
describe("toKitError", () => {
	it("converts an ApiError into a SvelteKit HttpError with the same status and message", () => {
		const thrown = catchThrown(() => toKitError(new ApiError("User not found", 404)));
		expect(thrown).toEqual({ status: 404, message: "User not found" });
	});

	it.each([403, 409, 500, 503])("preserves api status %i", (status) => {
		expect(catchThrown(() => toKitError(new ApiError("api failure", status))).status).toBe(status);
	});

	it("maps non-ApiErrors to a 500, keeping an Error's message", () => {
		const thrown = catchThrown(() => toKitError(new TypeError("fetch failed")));
		expect(thrown).toEqual({ status: 500, message: "fetch failed" });
	});

	it("maps non-Error throws to a 500 with the fallback message", () => {
		const thrown = catchThrown(() => toKitError("boom", "Failed to load thing"));
		expect(thrown).toEqual({ status: 500, message: "Failed to load thing" });
	});
});

// Runs in the browser environment (jsdom): hasSession() consults the client-side
// flag seeded by setClientSessionKnown (the httpOnly session cookie is invisible
// to JS), never the network.
describe("mintToken", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		clearMintedTokens();
		setClientSessionKnown(undefined);
	});

	// Regression (#324): the flag starts unseeded — the game page's /gameplay/* loads
	// race the layout load that seeds it, so "unknown" must attempt the mint (cold
	// reload of /game/<id> otherwise fires without Authorization → blanked state).
	it("attempts the mint while the session flag is not yet seeded", async () => {
		const token = { code: "tok-0", expiresAt: Date.now() + 3600_000 };
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(token), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);

		await expect(mintToken("gameplay", fetchMock)).resolves.toEqual(token);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("skips the /account/mint call entirely when there is no session cookie", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		setClientSessionKnown(false); // anonymous (SSR layout seeded user=null)

		await expect(mintToken("gameplay")).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("mints when a session exists and caches the token per scope", async () => {
		const token = { code: "tok-1", expiresAt: Date.now() + 3600_000 };
		// Passed explicitly: the module-level fallback fetch is captured at import
		// time, so a stubbed global wouldn't reach it (in the browser it's the
		// native fetch, which resolves relative URLs against the document).
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(token), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		setClientSessionKnown(true); // logged in (SSR layout seeded a user)

		await expect(mintToken("gameplay", fetchMock)).resolves.toEqual(token);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0][0]).toBe("/api/account/mint");

		// Cached until near expiry — no second call.
		await expect(mintToken("gameplay", fetchMock)).resolves.toEqual(token);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("returns null and clears the cache when the mint 401s (stale/expired session)", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }));
		setClientSessionKnown(true);

		await expect(mintToken("site", fetchMock)).resolves.toBeNull();
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
