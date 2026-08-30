const BASE = "/api";

export class ApiError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

type Token = { code: string; expiresAt: number };

/**
 * Mint a short-lived, narrowly-scoped access token (e.g. "gameplay" for the
 * game-server, which verifies JWTs by public key only). Auth is via the session
 * cookie — no refresh token is handled in JS, same as the web app
 * (apps/web/src/lib/api.ts). Cached per scope until near expiry.
 */
const mintedTokens: Record<string, Token> = {};

async function mintToken(scope: string): Promise<Token | null> {
	const existing = mintedTokens[scope];
	if (existing && existing.expiresAt > Date.now() + 5 * 60 * 1000) {
		return existing;
	}

	const res = await fetch(`${BASE}/account/mint`, {
		method: "POST",
		credentials: "same-origin",
		body: JSON.stringify({ scopes: [scope] }),
		headers: { "Content-Type": "application/json" },
	});

	if (res.status === 401 || res.status === 404) {
		delete mintedTokens[scope];
		return null; // not logged in
	}
	if (!res.ok) {
		return null;
	}

	const token: Token = await res.json();
	mintedTokens[scope] = token;
	return token;
}

export function clearMintedTokens(): void {
	for (const key of Object.keys(mintedTokens)) {
		delete mintedTokens[key];
	}
}

/**
 * The main API authenticates via the session cookie (sent automatically, incl. by the
 * server-side /api proxy). Only game-server calls (/api/gameplay/*) need a bearer
 * token — minted "gameplay"-scoped, same as the web app.
 */
async function authHeaderFor(url: string): Promise<Record<string, string>> {
	if (!url.startsWith("/api/gameplay")) {
		return {};
	}
	const token = await mintToken("gameplay").catch(() => null);
	return token ? { Authorization: `Bearer ${token.code}` } : {};
}

async function request<T = unknown>(
	method: string,
	path: string,
	body?: unknown,
	options?: { raw?: boolean },
): Promise<T> {
	const url = path.startsWith("/api") ? path : `${BASE}${path}`;

	const headers: Record<string, string> = await authHeaderFor(url);
	if (body !== undefined) {
		headers["Content-Type"] = "application/json";
	}

	const res = await fetch(url, {
		method,
		credentials: "same-origin",
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});

	if (options?.raw) {
		return res as unknown as T;
	}

	if (!res.ok) {
		const text = await res.text();
		let message: string;
		try {
			message = JSON.parse(text).message ?? text;
		} catch {
			message = text;
		}
		throw new ApiError(message || `Request failed: ${res.status}`, res.status);
	}

	const contentType = res.headers.get("content-type");
	if (contentType?.includes("application/json")) {
		return res.json();
	}
	return res.text() as unknown as T;
}

export const api = {
	get: <T = unknown>(path: string) => request<T>("GET", path),
	post: <T = unknown>(path: string, body: unknown = {}) => request<T>("POST", path, body),
	put: <T = unknown>(path: string, body: unknown = {}) => request<T>("PUT", path, body),
	patch: <T = unknown>(path: string, body: unknown = {}) => request<T>("PATCH", path, body),
	del: <T = unknown>(path: string) => request<T>("DELETE", path),
};

// Bulk page translation job (#306) — POST /admin/page/translate-bulk returns
// 202 + a job id; poll until the status turns terminal ("done" or "error").
export interface BulkTranslateJob {
	status: "running" | "done" | "error";
	// What the job translates; absent on pre-kind jobs, which are all page jobs.
	kind?: "pages" | "metadata" | "changelog";
	total: number;
	done: number;
	translated: number;
	skipped: number;
	errors: { page: string; lang: string; message: string }[];
	current?: { page: string; lang: string };
	createdAt?: string;
	updatedAt?: string;
	finishedAt?: string;
}

export interface ListedBulkTranslateJob extends BulkTranslateJob {
	jobId: string;
}

export interface TranslationsOverview {
	locales: string[];
	metaLangs: string[];
	pages: { name: string; title: string; cells: Record<string, { status: "ok" | "outdated" | "missing" }> }[];
	games: {
		game: string;
		label: string;
		alias?: string;
		sourceFields: string[];
		// "unknown" = overlay predates translatedFrom tracking (no stamp, so
		// freshness can't be told from the data).
		cells: Record<string, { status: "ok" | "outdated" | "missing" | "unknown"; fields: string[] }>;
	}[];
	// Changelog coverage (#306 follow-up): per-locale counts over the published
	// entries (a summary row, not a per-entry matrix).
	changelog: {
		total: number;
		cells: Record<string, { ok: number; outdated: number; missing: number; unknown: number }>;
	};
	jobs: ListedBulkTranslateJob[];
}

export async function loadTranslationsOverview(): Promise<TranslationsOverview> {
	return api.get<TranslationsOverview>("/admin/translations/overview");
}

export async function startBulkTranslate(body: { targetLang: string } | { pageName: string }): Promise<string> {
	const { jobId } = await api.post<{ jobId: string }>("/admin/page/translate-bulk", body);
	return jobId;
}

// Bulk game-metadata translation (#306 follow-up) — same 202 + job id flow as
// the pages variant; the job shows in the overview's jobs table. Covers every
// overlay needing translation: missing, outdated, or stamp-less pre-tracking
// ("unknown" — unverifiable, so re-translated once and stamped).
export async function startMetadataBulkTranslate(body: { targetLang?: string } = {}): Promise<string> {
	const { jobId } = await api.post<{ jobId: string }>("/admin/translations/translate-metadata-bulk", body);
	return jobId;
}

// Bulk changelog translation (#306 follow-up) — same flow again. {entryId}
// translates one entry into all languages (the changelog page's per-entry
// button); {targetLang} one language across all published entries; {} every
// missing/outdated pair. Returns the job id and the pair count (0 = nothing
// to do). Requires the "changelog" permission.
export async function startChangelogBulkTranslate(
	body: { targetLang?: string; entryId?: string } = {},
): Promise<{ jobId: string; total: number }> {
	return api.post<{ jobId: string; total: number }>("/admin/changelog/translate-bulk", body);
}

// `pollPath` defaults to the pages poll route; changelog admins (who may not
// hold "pages") poll their jobs through their own mount instead.
export function pollBulkTranslateJob(
	jobId: string,
	onProgress?: (job: BulkTranslateJob) => void,
	intervalMs = 1500,
	pollPath = "/admin/page/translate-bulk",
): Promise<BulkTranslateJob> {
	return new Promise((resolve, reject) => {
		const tick = async () => {
			try {
				const job = await api.get<BulkTranslateJob>(`${pollPath}/${jobId}`);
				onProgress?.(job);
				if (job.status !== "running") {
					resolve(job);
				} else {
					setTimeout(tick, intervalMs);
				}
			} catch (err) {
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		};
		void tick();
	});
}
