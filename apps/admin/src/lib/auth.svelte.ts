import type { UserFront } from "@bgs/models";

interface Token {
	code: string;
	expiresAt: number;
}

interface AuthResponse {
	user: UserFront & { _id: string };
	accessToken: Token;
	refreshToken: Token;
}

const STORAGE_KEY = "bgs-admin-refresh-token";

// Plain JS — not $state. These are read/written by api.ts on every request and
// never need to trigger UI reactivity (the UI reacts to `data.user` from +layout.ts).
let refreshToken: Token | null = loadRefreshToken();
const accessTokens: Record<string, Token> = {};

function loadRefreshToken(): Token | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

export function setTokens(data: AuthResponse) {
	refreshToken = data.refreshToken;
	accessTokens["all"] = data.accessToken;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(data.refreshToken));
}

export function clearTokens() {
	refreshToken = null;
	for (const key of Object.keys(accessTokens)) {
		delete accessTokens[key];
	}
	localStorage.removeItem(STORAGE_KEY);
}

export const tokens = {
	get refresh(): Token | null {
		return refreshToken;
	},
	getAccess(scope: string): Token | undefined {
		return accessTokens[scope];
	},
	setAccess(scope: string, token: Token): void {
		accessTokens[scope] = token;
	},
};
