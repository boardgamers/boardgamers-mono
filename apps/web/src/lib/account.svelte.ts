import { invalidateAll } from "$app/navigation";
import type { UserFront } from "@bgs/models";
import { handleError } from "@/utils";
import { account, setAccount } from "./stores.svelte";
import { post, clearMintedTokens } from "./api";

export { account };

export type AuthData = {
	user: UserFront;
};

/**
 * After any auth change the session cookie differs, so every per-user `load` must re-run.
 * `invalidateAll()` re-runs all active load functions (the root layout re-fetches /account,
 * pages re-fetch their per-user data), keeping the UI consistent without a full reload.
 */
async function refreshAfterAuthChange(user: UserFront | null) {
	setAccount(user);
	await invalidateAll();
}

export async function loadAccount() {
	try {
		const user = await post<UserFront | null>("/account").catch((err) => {
			if (err.status !== 401 && err.status !== 404) handleError(err);
			return null;
		});
		if (user) {
			await refreshAfterAuthChange(user);
		}
	} catch {
		// ignore
	}
}

/**
 * Login/signup/social-auth: the API sets the session cookie in the response. We seed the
 * account store with the returned user, then invalidate so per-user loads re-run.
 */
export function setAuthData(data: AuthData) {
	return refreshAfterAuthChange(data.user);
}

export function login(email: string, password: string) {
	return post<AuthData>("/account/login", { email, password }).then(setAuthData);
}

export async function logout() {
	await post("/account/signout");
	clearMintedTokens();
	await refreshAfterAuthChange(null);
}
