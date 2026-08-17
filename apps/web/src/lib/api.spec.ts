import { isHttpError } from "@sveltejs/kit";
import { describe, expect, it } from "vitest";
import { ApiError, toKitError } from "./api";

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
