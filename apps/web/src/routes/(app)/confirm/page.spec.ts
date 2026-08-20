import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ post: vi.fn() }));
vi.mock("@/lib/account.svelte", () => ({ setAuthData: vi.fn((data: unknown) => Promise.resolve(data)) }));
vi.mock("@/lib/notifications.svelte", () => ({ notifier: { info: vi.fn() } }));
vi.mock("$app/navigation", () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock("$app/paths", () => ({ resolve: (id: string) => id.replace(/^\/\(app\)/, "") }));

import { post } from "@/lib/api";
import { setAuthData } from "@/lib/account.svelte";
import { notifier } from "@/lib/notifications.svelte";
import { goto } from "$app/navigation";
import { load } from "./+page";
import type { PageLoad } from "./$types";

const postMock = vi.mocked(post);
const setAuthDataMock = vi.mocked(setAuthData);
const infoMock = vi.mocked(notifier.info);
const gotoMock = vi.mocked(goto);

function runLoad(search = "?key=abc&email=user@test.com") {
	return load({ url: new URL(`http://localhost/confirm${search}`) } as unknown as Parameters<PageLoad>[0]);
}

describe("confirm page load", () => {
	beforeEach(() => {
		postMock.mockReset();
		setAuthDataMock.mockClear();
		infoMock.mockClear();
		gotoMock.mockClear();
	});

	it("confirms, sets auth, and goes to /account", async () => {
		const authData = { user: { account: { email: "user@test.com" } } };
		postMock.mockResolvedValue(authData as never);

		await runLoad();

		expect(setAuthDataMock).toHaveBeenCalledWith(authData);
		expect(gotoMock).toHaveBeenCalledWith("/account");
		expect(infoMock).not.toHaveBeenCalled();
	});

	it("already-confirmed: still lands on /account, with an info toast", async () => {
		const authData = { user: { account: { email: "user@test.com" } }, alreadyConfirmed: true };
		postMock.mockResolvedValue(authData as never);

		await runLoad();

		expect(setAuthDataMock).toHaveBeenCalledWith({ user: authData.user });
		expect(gotoMock).toHaveBeenCalledWith("/account");
		expect(infoMock).toHaveBeenCalledOnce();
	});

	it("propagates api errors (wrong key, unknown email) to the error page", async () => {
		postMock.mockRejectedValue(new Error("Wrong confirm link."));

		await expect(runLoad()).rejects.toThrow("Wrong confirm link.");
		expect(setAuthDataMock).not.toHaveBeenCalled();
		expect(gotoMock).not.toHaveBeenCalled();
	});
});
