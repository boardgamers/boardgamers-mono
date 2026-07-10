import type { UserFront } from "@bgs/models";

interface Token {
	code: string;
	expiresAt: number;
}

interface AuthState {
	user: (UserFront & { _id: string }) | null;
	refreshToken: Token | null;
	accessTokens: Record<string, Token>;
}

const STORAGE_KEY = "bgs-admin-refresh-token";

function loadRefreshToken(): Token | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

export const auth: AuthState = $state({
	user: null,
	refreshToken: loadRefreshToken(),
	accessTokens: {},
});

export function setAuth(data: { user: AuthState["user"]; accessToken: Token; refreshToken: Token }) {
	auth.user = data.user;
	auth.refreshToken = data.refreshToken;
	auth.accessTokens["all"] = data.accessToken;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(data.refreshToken));
}

export function logOut() {
	auth.user = null;
	auth.refreshToken = null;
	auth.accessTokens = {};
	localStorage.removeItem(STORAGE_KEY);
}

export function isLoggedIn(): boolean {
	return !!auth.user;
}
