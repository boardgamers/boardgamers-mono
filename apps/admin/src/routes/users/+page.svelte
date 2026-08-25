<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { timeAgo } from "$lib/utils.ts";
	import { locales } from "@bgs/models/locale";

	interface UserResult {
		_id: string;
		account: { username: string; email: string };
		authority?: string;
		adminGrants?: string[];
		createdAt?: string;
	}

	interface AdminUser extends UserResult {
		security?: {
			lastOnline?: string;
			lastActive?: string;
			lastLogin?: { ip: string; date: string };
		};
		games: { total: number; active: number; ended: number };
	}

	interface UserStats {
		totalUsers: number;
		confirmedUsers: number;
		adminUsers: number;
		onlineUsers: number;
		connectedUsers: number;
		newUsersByDay: { date: string; count: number }[];
	}

	interface CountryStats {
		countries: { country: string; count: number }[];
		unset: number;
		engagement: { newsletter: number; webhook: number; discord: number; bio: number };
	}

	// Instant-vector Loki response (same shape the health page parses).
	interface LokiInstantResult {
		status: string;
		data: {
			resultType: "vector";
			result: { metric: Record<string, string>; value: [number, string] }[];
		};
	}

	let query = $state("");
	let results: UserResult[] = $state([]);
	let searching = $state(false);
	let selected = $state(0);
	let debounceId: ReturnType<typeof setTimeout> | undefined;

	let admins: AdminUser[] = $state([]);
	let loadingAdmins = $state(true);
	let promoting = $state<string | null>(null);

	interface LoginMethods {
		recentDays: number;
		perMethod: { recent: Record<Method, number>; older: Record<Method, number> };
		combinations: { methods: Method[]; recent: number; older: number }[];
		sessions: Record<string, number>;
		trend: { weeks: number; methods: string[]; loginsByWeek: Record<string, string | number>[] };
	}
	type Method = "password" | "google" | "facebook" | "discord" | "github" | "huggingface";
	const methodLabels: Record<Method, string> = {
		password: "Password",
		google: "Google",
		facebook: "Facebook",
		discord: "Discord",
		github: "GitHub",
		huggingface: "Hugging Face",
	};

	// Palette chosen for distinguishability (the previous one had three near-identical
	// blues for password/facebook/discord). Each method gets a distinct hue spaced
	// around the color wheel, all 500-level so they read in both light and dark mode.
	// Brand-ish where cheap: facebook stays a blue, discord a violet ("blurple").
	const trendColor = (method: string) =>
		({
			password: "#10b981", // emerald — clearly distinct from the blues
			google: "#ef4444", // red
			facebook: "#3b82f6", // blue (Facebook)
			discord: "#8b5cf6", // violet (Discord blurple, separated from facebook blue)
			// #24292e (GitHub dark) vanishes in dark mode; this gray reads on both themes.
			github: "#6b7280", // gray
			huggingface: "#f59e0b", // amber
			// pink (was purple — too close to the new discord violet). Reachable: the
			// /api/admin/login-as route stamps loginMethod:"admin" on the refresh token.
			admin: "#ec4899",
			unknown: "#9ca3af", // light gray
		})[method] ?? "#14b8a6";

	function linePath(values: number[], max: number, width: number, height: number): string {
		if (values.length === 0) return "";
		const pts = values.map((v, i) => [
			(i / Math.max(values.length - 1, 1)) * width,
			height - (v / Math.max(max, 1)) * height,
		]);
		return pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
	}

	// The SVG uses viewBox "0 0 400 100" — keep these in sync for hover mapping.
	const TREND_W = 400;
	const TREND_H = 100;

	// Hovered week index in the login-trend chart; null when the pointer is off the
	// SVG. Client-only interaction (onmousemove), so it's SSR-safe.
	let trendHover = $state<number | null>(null);
	// Pointer x as a 0–1 fraction across the SVG, to position the tooltip near the cursor.
	let trendHoverX = $state(0);

	function onTrendMove(e: MouseEvent & { currentTarget: SVGSVGElement }) {
		const weeks = loginMethods?.trend.loginsByWeek ?? [];
		if (weeks.length === 0) {
			trendHover = null;
			return;
		}
		const rect = e.currentTarget.getBoundingClientRect();
		const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
		trendHoverX = Math.min(1, Math.max(0, frac));
		// Nearest point index: points sit at i/(n-1) across the width.
		trendHover = Math.min(weeks.length - 1, Math.max(0, Math.round(trendHoverX * (weeks.length - 1))));
	}

	function onTrendLeave() {
		trendHover = null;
	}

	let stats = $state<UserStats | null>(null);
	let loginMethods = $state<LoginMethods | null>(null);
	let countryStats = $state<CountryStats | null>(null);

	// Languages (Accept-Language) — loaded client-side from the Loki proxy so the
	// page never hangs on Loki latency. `undefined` = loading, `null` = unavailable.
	let langStats = $state<{ language: string; count: number }[] | null | undefined>(undefined);

	// Traffic (top referer sites + user-agents) — same client-side Loki pattern.
	let refererStats = $state<{ referer: string; count: number }[] | null | undefined>(undefined);
	let uaStats = $state<{ ua: string; count: number }[] | null | undefined>(undefined);

	// Cheap "likely bot/scraper" heuristic for flagging user-agent rows. Deliberately
	// simple — it's a visual hint, not a filter.
	const BOT_PATTERN =
		/bot|crawler|spider|scrape|slurp|python|curl|wget|httpclient|headless|phantom|axios|go-http|java\//i;
	const isLikelyBot = (ua: string) => BOT_PATTERN.test(ua);

	// Languages the site is actually translated into (UI locales, #306) — base
	// subtags, since the stats below are keyed by Accept-Language base subtag.
	const SUPPORTED_LANGUAGES: readonly string[] = [...new Set(locales.map((l) => l.split("-")[0]))];

	// Country code → display name, localized in English (no new dep).
	const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
	const countryName = (code: string) => countryNames.of(code) ?? code;
	// Language code → display name, localized in English (no new dep).
	const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
	const languageName = (code: string) => languageNames.of(code) ?? code;

	const trendMax = $derived(
		Math.max(1, ...(loginMethods?.trend.loginsByWeek ?? []).flatMap((w) => Object.values(w).slice(1).map(Number)))
	);
	const totalSessions = $derived(Object.values(loginMethods?.sessions ?? {}).reduce((acc, n) => acc + n, 0));

	const comboPageSize = 10;
	let comboFilter = $state<Method | "all">("all");
	let comboPage = $state(0);
	const filteredCombos = $derived(
		(loginMethods?.combinations ?? []).filter((c) => comboFilter === "all" || c.methods.includes(comboFilter))
	);
	const comboPageCount = $derived(Math.max(1, Math.ceil(filteredCombos.length / comboPageSize)));
	const pagedCombos = $derived(
		filteredCombos.slice(
			Math.min(comboPage, comboPageCount - 1) * comboPageSize,
			(Math.min(comboPage, comboPageCount - 1) + 1) * comboPageSize
		)
	);

	function toggleComboFilter(method: Method) {
		comboFilter = comboFilter === method ? "all" : method;
		comboPage = 0;
	}

	async function loadLoginMethods() {
		try {
			loginMethods = await api.get<LoginMethods>("/admin/users/login-methods");
		} catch {
			loginMethods = null;
		}
	}

	async function loadAdmins() {
		loadingAdmins = true;
		try {
			admins = await api.get("/admin/users/admins");
		} catch {
			admins = [];
		} finally {
			loadingAdmins = false;
		}
	}

	async function loadStats() {
		try {
			stats = await api.get<UserStats>("/admin/users/stats");
		} catch {
			stats = null;
		}
	}

	async function loadCountryStats() {
		try {
			countryStats = await api.get<CountryStats>("/admin/users/countries");
		} catch {
			countryStats = null;
		}
	}

	// Client-side (like the health page's Loki panels): a Loki outage or slow query
	// must not block the rest of the page — degrade to a "Loki unavailable" note.
	async function loadLanguageStats() {
		try {
			const res = await api.get<LokiInstantResult>("/admin/loki/query/requestsByLanguage");
			langStats = (res.data.result ?? [])
				.map((r) => ({ language: r.metric.lang ?? "?", count: Math.round(Number(r.value[1])) }))
				.filter((l) => l.language !== "?" && l.count > 0)
				.sort((a, b) => b.count - a.count);
		} catch {
			langStats = null;
		}
	}

	// Top referer sites + user-agents, same client-side Loki pattern. The
	// topReferers query groups by extracted origin (see loki.ts), so its series
	// carry an `origin` label — a bare host like "boardgamegeek.com".
	async function loadTrafficStats() {
		try {
			const res = await api.get<LokiInstantResult>("/admin/loki/query/topReferers");
			refererStats = (res.data.result ?? [])
				.map((r) => ({ referer: r.metric.origin ?? "?", count: Math.round(Number(r.value[1])) }))
				.filter((x) => x.referer !== "?" && x.count > 0)
				.sort((a, b) => b.count - a.count);
		} catch {
			refererStats = null;
		}
		try {
			const res = await api.get<LokiInstantResult>("/admin/loki/query/topUserAgents");
			uaStats = (res.data.result ?? [])
				.map((r) => ({ ua: r.metric.ua ?? "?", count: Math.round(Number(r.value[1])) }))
				.filter((x) => x.ua !== "?" && x.count > 0)
				.sort((a, b) => b.count - a.count);
		} catch {
			uaStats = null;
		}
	}

	async function search() {
		clearTimeout(debounceId);
		debounceId = setTimeout(async () => {
			if (query.trim().length < 2) {
				results = [];
				return;
			}
			searching = true;
			selected = 0;
			try {
				results = await api.get(`/admin/users/search?search=${encodeURIComponent(query)}`);
			} catch {
				results = [];
			} finally {
				searching = false;
			}
		}, 200);
	}

	function select(username: string) {
		goto(resolve("/user/[username]", { username }));
	}

	function onkeydown(e: KeyboardEvent) {
		if (results.length === 0) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			selected = Math.min(selected + 1, results.length - 1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			selected = Math.max(selected - 1, 0);
		} else if (e.key === "Enter" && results[selected]) {
			e.preventDefault();
			select(results[selected].account.username);
		}
	}

	async function promote(userId: string, username: string) {
		promoting = userId;
		try {
			await api.post(`/admin/users/${userId}/authority`, { authority: "admin" });
			toast.success(`${username} is now an admin`);
			await Promise.all([loadAdmins(), loadStats()]);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		} finally {
			promoting = null;
		}
	}

	async function demote(userId: string, username: string) {
		promoting = userId;
		try {
			await api.post(`/admin/users/${userId}/authority`, { authority: "user" });
			toast.success(`${username} is no longer an admin`);
			await Promise.all([loadAdmins(), loadStats()]);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		} finally {
			promoting = null;
		}
	}

	const grantBadges = (admin: AdminUser) =>
		(admin.adminGrants ?? []).map((g) =>
			g.startsWith("gameinfo:") ? { key: g, label: `🎲 ${g.slice("gameinfo:".length)}` } : { key: g, label: g }
		);

	const maxCount = $derived(Math.max(1, ...(stats?.newUsersByDay ?? []).map((d) => d.count)));
	const confirmedPct = $derived(stats ? Math.round((stats.confirmedUsers / Math.max(stats.totalUsers, 1)) * 100) : 0);

	// % shares are computed over users who SET a country (the meaningful denominator).
	const countrySetTotal = $derived((countryStats?.countries ?? []).reduce((acc, c) => acc + c.count, 0));
	// Total language-tagged requests, for per-language shares.
	const langTotal = $derived((langStats ?? []).reduce((acc, l) => acc + l.count, 0));
	// Totals for referer/ua shares (top-N, so these are "of the shown top-N").
	const refererTotal = $derived((refererStats ?? []).reduce((acc, r) => acc + r.count, 0));
	const uaTotal = $derived((uaStats ?? []).reduce((acc, u) => acc + u.count, 0));

	loadAdmins();
	loadStats();
	loadLoginMethods();
	loadCountryStats();
	loadLanguageStats();
	loadTrafficStats();
</script>

<svelte:head>
	<title>Users — Admin</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between gap-3 flex-wrap">
		<h2 class="text-xl font-bold">Users</h2>
		<a href={resolve("/users/deleted")} class="text-sm text-blue-600 dark:text-blue-400 hover:underline"
			>Deleted users →</a
		>
	</div>

	<!-- Metrics -->
	{#if stats}
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total</div>
				<div class="text-2xl font-bold mt-1">{stats.totalUsers.toLocaleString()}</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Online</div>
				<div class="text-2xl font-bold mt-1 flex items-center gap-2">
					<span class="inline-block w-2.5 h-2.5 rounded-full {stats.onlineUsers > 0 ? 'bg-green-500' : 'bg-gray-400'}"
					></span>
					{stats.onlineUsers}
				</div>
				{#if stats.connectedUsers > stats.onlineUsers}
					<div class="text-xs text-gray-400 mt-0.5">{stats.connectedUsers} connected</div>
				{/if}
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Confirmed</div>
				<div class="text-2xl font-bold mt-1">{stats.confirmedUsers.toLocaleString()}</div>
				<div class="text-xs text-gray-400 mt-0.5">{confirmedPct}% of total</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Admins</div>
				<div class="text-2xl font-bold mt-1">{stats.adminUsers}</div>
			</div>
		</div>
	{/if}

	<!-- User management: search + admins come first (the actionable part of the
	     page); the analytics below are informational. -->
	<!-- Search -->
	<div class="relative">
		<div class="relative">
			<svg
				class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
			<input
				bind:value={query}
				oninput={search}
				{onkeydown}
				placeholder="Search by username or email..."
				class="w-full pl-10 pr-10 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				autocomplete="off"
			/>
			{#if searching}
				<div class="absolute right-3 top-1/2 -translate-y-1/2">
					<div class="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
				</div>
			{/if}
		</div>

		{#if results.length > 0}
			<div
				class="absolute z-10 mt-2 w-full bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden"
			>
				{#each results as user, i (user._id)}
					<button
						class="w-full px-4 py-3 text-left flex items-center gap-3 transition-colors {i === selected
							? 'bg-blue-50 dark:bg-blue-900/30'
							: 'hover:bg-gray-50 dark:hover:bg-gray-800'}"
						onclick={() => select(user.account.username)}
						onmouseenter={() => (selected = i)}
					>
						<div
							class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-500 dark:text-gray-400 flex-shrink-0"
						>
							{user.account.username.charAt(0).toUpperCase()}
						</div>
						<div class="min-w-0 flex-1">
							<div class="font-medium text-sm truncate">
								{user.account.username}
								{#if user.authority === "admin"}
									<span
										class="ml-1 px-1.5 py-0.5 text-[10px] font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded"
										>admin</span
									>
								{:else if user.adminGrants?.length}
									<span
										class="ml-1 px-1.5 py-0.5 text-[10px] font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded"
										>scoped admin</span
									>
								{/if}
							</div>
							<div class="text-xs text-gray-500 truncate">{user.account.email}</div>
						</div>
						<svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
						</svg>
					</button>
				{/each}
			</div>
		{:else if query.length >= 2 && !searching}
			<p class="mt-3 text-sm text-gray-500">No users found.</p>
		{/if}
	</div>

	{#if query.length < 2}
		<p class="text-sm text-gray-400">Search for users by username or email to view and manage their account.</p>
	{/if}

	<!-- Admins -->
	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
		<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
			<h3 class="text-sm font-semibold">
				Admins
				<span class="text-gray-400 font-normal">({admins.length})</span>
			</h3>
			{#if loadingAdmins}
				<div class="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
			{/if}
		</div>
		{#if admins.length > 0}
			<div class="divide-y divide-gray-100 dark:divide-gray-800">
				{#each admins as admin (admin._id)}
					<div class="px-5 py-3 flex items-center gap-3">
						<div
							class="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center text-sm font-medium text-purple-600 dark:text-purple-400 flex-shrink-0"
						>
							{admin.account.username.charAt(0).toUpperCase()}
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1.5 flex-wrap">
								<button
									onclick={() => select(admin.account.username)}
									class="font-medium text-sm text-blue-600 dark:text-blue-400 hover:underline truncate"
								>
									{admin.account.username}
								</button>
								{#if admin.authority === "admin"}
									<span
										class="px-1.5 py-0.5 text-[10px] font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded"
										>full admin</span
									>
								{:else}
									{#each grantBadges(admin) as badge (badge.key)}
										<span
											class="px-1.5 py-0.5 text-[10px] font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded"
											>{badge.label}</span
										>
									{/each}
								{/if}
							</div>
							<div class="flex items-center gap-2 text-xs text-gray-500">
								<span
									class="inline-block w-1.5 h-1.5 rounded-full {admin.security?.lastOnline &&
									Date.now() - new Date(admin.security.lastOnline).getTime() < 60000
										? 'bg-green-500'
										: 'bg-gray-400'}"
								></span>
								<span class="truncate"
									>seen {timeAgo(admin.security?.lastActive ?? admin.security?.lastLogin?.date)}</span
								>
								{#if admin.games.total > 0}
									<span class="text-gray-400">· {admin.games.total} games</span>
								{/if}
							</div>
						</div>
						<button
							onclick={() => demote(admin._id, admin.account.username)}
							disabled={promoting === admin._id}
							class="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg disabled:opacity-50 flex-shrink-0"
						>
							{promoting === admin._id ? "…" : "Demote"}
						</button>
					</div>
				{/each}
			</div>
		{:else if !loadingAdmins}
			<p class="px-5 py-4 text-sm text-gray-500">No admins found.</p>
		{/if}
	</div>

	<!-- Analytics (informational): charts, breakdowns, languages, traffic, login methods. -->
	{#if stats}
		<!-- New users chart -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
			<h3 class="text-sm font-semibold mb-4">New users — last 30 days</h3>
			{#if stats.newUsersByDay.some((d) => d.count > 0)}
				<div class="flex items-end gap-[2px] h-32">
					{#each stats.newUsersByDay as d (d.date)}
						<div
							class="flex-1 bg-blue-500 dark:bg-blue-400 rounded-t-sm hover:bg-blue-600 dark:hover:bg-blue-300 transition-colors relative group"
							style="height: {Math.max((d.count / maxCount) * 100, 2)}%"
						>
							<div
								class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
							>
								{d.date}: {d.count}
							</div>
						</div>
					{/each}
				</div>
				<div class="flex justify-between mt-2 text-[10px] text-gray-400">
					<span>{stats.newUsersByDay[0]?.date ?? ""}</span>
					<span>{stats.newUsersByDay[stats.newUsersByDay.length - 1]?.date ?? ""}</span>
				</div>
			{:else}
				<p class="text-sm text-gray-400">No new users in the last 30 days.</p>
			{/if}
		</div>
	{/if}

	<!-- Narrow analytics cards, paired 2-up on large screens (wide charts stay full-width) -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<!-- Engagement / feature adoption -->
		{#if countryStats && stats}
			{@const total = Math.max(stats.totalUsers, 1)}
			{@const engagementRows = [
				{ label: "Newsletter enabled", count: countryStats.engagement.newsletter },
				{ label: "Discord linked", count: countryStats.engagement.discord },
				{ label: "Country set", count: countrySetTotal },
				{ label: "Bio written", count: countryStats.engagement.bio },
				{ label: "Notification webhook", count: countryStats.engagement.webhook },
			].sort((a, b) => b.count - a.count)}
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
				<h3 class="text-sm font-semibold mb-1">Engagement</h3>
				<p class="text-xs text-gray-400 mb-4">Feature adoption across all {stats.totalUsers.toLocaleString()} users.</p>
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
								<th class="py-2 pr-4">Feature</th>
								<th class="py-2 pr-4 text-right">Users</th>
								<th class="py-2 text-right">% of all</th>
							</tr>
						</thead>
						<tbody>
							{#each engagementRows as row (row.label)}
								<tr class="border-b border-gray-50 dark:border-gray-800/50">
									<td class="py-2 pr-4 font-medium">{row.label}</td>
									<td class="py-2 pr-4 text-right">{row.count.toLocaleString()}</td>
									<td class="py-2 text-right text-gray-500">{Math.round((row.count / total) * 100)}%</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<!-- Users by country -->
		{#if countryStats}
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
				<h3 class="text-sm font-semibold mb-1">Users by country</h3>
				<p class="text-xs text-gray-400 mb-4">
					Self-chosen country on user profiles. Shares are over the {countrySetTotal.toLocaleString()} users who set one —
					{countryStats.unset.toLocaleString()}
					users ({countrySetTotal + countryStats.unset > 0
						? Math.round((countryStats.unset / (countrySetTotal + countryStats.unset)) * 100)
						: 0}% of all) haven't.
				</p>
				{#if countryStats.countries.length > 0}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
									<th class="py-2 pr-4">Country</th>
									<th class="py-2 pr-4 text-right">Users</th>
									<th class="py-2 text-right">Share</th>
								</tr>
							</thead>
							<tbody>
								{#each countryStats.countries as c (c.country)}
									<tr class="border-b border-gray-50 dark:border-gray-800/50">
										<td class="py-2 pr-4 font-medium">
											{countryName(c.country)} <span class="text-gray-400 font-normal">({c.country})</span>
										</td>
										<td class="py-2 pr-4 text-right">{c.count.toLocaleString()}</td>
										<td class="py-2 text-right text-gray-500">
											{countrySetTotal > 0 ? Math.round((c.count / countrySetTotal) * 100) : 0}%
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="text-sm text-gray-400">No users have set a country yet.</p>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Languages + Traffic, paired 2-up on large screens -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<!-- Languages (Accept-Language) — which languages to translate first -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
			<div class="flex items-center justify-between mb-1">
				<h3 class="text-sm font-semibold">Languages (Accept-Language)</h3>
				<a
					href="https://grafana.boardgamers.space/d/bgs-health"
					target="_blank"
					rel="noopener"
					class="text-xs text-blue-600 dark:text-blue-400 hover:underline">Open in Grafana →</a
				>
			</div>
			<p class="text-xs text-gray-400 mb-4">
				Visitors' preferred browser language over the last 7 days (from web request logs). Use it to decide which
				languages an i18n effort should target first.
			</p>
			{#if langStats === undefined}
				<div class="flex items-center gap-2 text-sm text-gray-400">
					<div class="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
					Loading language stats…
				</div>
			{:else if langStats === null}
				<div
					class="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl"
				>
					<span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-500"></span>
					<div class="text-sm">
						<span class="font-medium text-amber-700 dark:text-amber-400">Loki is unavailable.</span>
						<span class="text-amber-600 dark:text-amber-500/80"> Language stats come from request logs.</span>
					</div>
				</div>
			{:else if langStats.length === 0}
				<p class="text-sm text-gray-400">No language data yet — the web request logger needs to record some traffic.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
								<th class="py-2 pr-4">Language</th>
								<th class="py-2 pr-4 text-right">Requests</th>
								<th class="py-2 pr-4 text-right">Share</th>
								<th class="py-2 text-right" title="Site has a translation for this language">Translated</th>
							</tr>
						</thead>
						<tbody>
							{#each langStats as l (l.language)}
								<tr class="border-b border-gray-50 dark:border-gray-800/50">
									<td class="py-2 pr-4 font-medium">
										{languageName(l.language)} <span class="text-gray-400 font-normal">({l.language})</span>
									</td>
									<td class="py-2 pr-4 text-right">{l.count.toLocaleString()}</td>
									<td class="py-2 pr-4 text-right text-gray-500">
										{langTotal > 0 ? Math.round((l.count / langTotal) * 100) : 0}%
									</td>
									<td class="py-2 text-right">
										{#if SUPPORTED_LANGUAGES.includes(l.language)}
											<span class="text-green-500" title="Translated">✓</span>
										{:else}
											<span class="text-gray-300 dark:text-gray-600" title="No translation">—</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		<!-- Traffic (top referers + user-agents) — where requests come from, bot spotting -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
			<div class="flex items-center justify-between mb-1">
				<h3 class="text-sm font-semibold">Traffic</h3>
				<a
					href="https://grafana.boardgamers.space/d/bgs-health"
					target="_blank"
					rel="noopener"
					class="text-xs text-blue-600 dark:text-blue-400 hover:underline">Open in Grafana →</a
				>
			</div>
			<p class="text-xs text-gray-400 mb-4">
				Top referer sites and user-agents over the last 7 days (from web request logs) — where traffic comes from, and a
				quick way to spot scrapers.
			</p>
			{#if refererStats === undefined || uaStats === undefined}
				<div class="flex items-center gap-2 text-sm text-gray-400">
					<div class="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
					Loading traffic stats…
				</div>
			{:else if refererStats === null || uaStats === null}
				<div
					class="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl"
				>
					<span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-500"></span>
					<div class="text-sm">
						<span class="font-medium text-amber-700 dark:text-amber-400">Loki is unavailable.</span>
						<span class="text-amber-600 dark:text-amber-500/80"> Traffic stats come from request logs.</span>
					</div>
				</div>
			{:else}
				<!-- The card is half-width (lg:grid-cols-2), so the referer/UA tables stack
				     vertically — splitting ~550px into two columns crams the counts. -->
				<div class="grid grid-cols-1 gap-6">
					<!-- Top referer sites (grouped by origin/host, not full URL) -->
					<div class="overflow-x-auto min-w-0">
						<h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
							Top referers by site
						</h4>
						{#if refererStats.length === 0}
							<p class="text-sm text-gray-400">No referer data yet.</p>
						{:else}
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
										<th class="py-2 pr-4">Site</th>
										<th class="py-2 pr-4 text-right">Requests</th>
										<th class="py-2 text-right">Share</th>
									</tr>
								</thead>
								<tbody>
									{#each refererStats as r (r.referer)}
										<tr class="border-b border-gray-50 dark:border-gray-800/50">
											<td class="py-2 pr-4 font-medium truncate max-w-[280px]" title={r.referer}>{r.referer}</td>
											<td class="py-2 pr-4 text-right whitespace-nowrap">{r.count.toLocaleString()}</td>
											<td class="py-2 text-right text-gray-500 whitespace-nowrap">
												{refererTotal > 0 ? Math.round((r.count / refererTotal) * 100) : 0}%
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
					</div>
					<!-- Top user-agents -->
					<div class="overflow-x-auto min-w-0">
						<h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
							Top user-agents
						</h4>
						{#if uaStats.length === 0}
							<p class="text-sm text-gray-400">No user-agent data yet.</p>
						{:else}
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
										<th class="py-2 pr-4">User-Agent</th>
										<th class="py-2 pr-4 text-right">Requests</th>
										<th class="py-2 text-right">Share</th>
									</tr>
								</thead>
								<tbody>
									{#each uaStats as u (u.ua)}
										<tr class="border-b border-gray-50 dark:border-gray-800/50">
											<td class="py-2 pr-4 font-medium truncate max-w-[280px]" title={u.ua}>
												{u.ua}
												{#if isLikelyBot(u.ua)}
													<span
														class="ml-1 px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 rounded"
														>bot?</span
													>
												{/if}
											</td>
											<td class="py-2 pr-4 text-right whitespace-nowrap">{u.count.toLocaleString()}</td>
											<td class="py-2 text-right text-gray-500 whitespace-nowrap">
												{uaTotal > 0 ? Math.round((u.count / uaTotal) * 100) : 0}%
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Login methods -->
	{#if loginMethods}
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
			<h3 class="text-sm font-semibold mb-1">Login methods</h3>
			<p class="text-xs text-gray-400 mb-4">
				Users by login mechanism on their account — a user with several linked methods counts once per method in totals,
				once per combination below. Active = logged in within the last {loginMethods.recentDays} days. Click a method to filter
				the combinations table.
			</p>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
								<th class="py-2 pr-4">Method</th>
								<th class="py-2 pr-4 text-right">Active</th>
								<th class="py-2 text-right">Inactive / never</th>
							</tr>
						</thead>
						<tbody>
							{#each Object.keys(methodLabels) as method (method)}
								<tr
									class="border-b border-gray-50 dark:border-gray-800/50 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 {comboFilter ===
									method
										? 'bg-blue-50 dark:bg-blue-900/30'
										: ''}"
									onclick={() => toggleComboFilter(method as Method)}
								>
									<td class="py-2 pr-4 font-medium">{methodLabels[method as Method]}</td>
									<td class="py-2 pr-4 text-right">{loginMethods.perMethod.recent[method as Method]}</td>
									<td class="py-2 text-right text-gray-500">{loginMethods.perMethod.older[method as Method]}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div class="overflow-x-auto">
					<div class="flex flex-wrap gap-1.5 mb-3">
						<button
							class="px-2.5 py-1 text-xs font-medium rounded-full transition-colors {comboFilter === 'all'
								? 'bg-blue-600 text-white'
								: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}"
							onclick={() => (comboFilter = "all")}
						>
							All
						</button>
						{#each Object.keys(methodLabels) as method (method)}
							<button
								class="px-2.5 py-1 text-xs font-medium rounded-full transition-colors {comboFilter === method
									? 'bg-blue-600 text-white'
									: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}"
								onclick={() => toggleComboFilter(method as Method)}
							>
								{methodLabels[method as Method]}
							</button>
						{/each}
					</div>
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
								<th class="py-2 pr-4">Combination</th>
								<th class="py-2 pr-4 text-right">Active</th>
								<th class="py-2 text-right">Inactive / never</th>
							</tr>
						</thead>
						<tbody>
							{#each pagedCombos as combo (combo.methods.join("+"))}
								<tr class="border-b border-gray-50 dark:border-gray-800/50">
									<td class="py-2 pr-4 font-medium">
										{combo.methods.length ? combo.methods.map((m) => methodLabels[m]).join(" + ") : "None"}
									</td>
									<td class="py-2 pr-4 text-right">{combo.recent}</td>
									<td class="py-2 text-right text-gray-500">{combo.older}</td>
								</tr>
							{:else}
								<tr>
									<td colspan="3" class="py-4 text-sm text-gray-400">No combinations match this filter.</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if comboPageCount > 1}
						<div class="flex items-center justify-between mt-3 text-xs text-gray-500">
							<button
								class="px-3 py-1.5 font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg disabled:opacity-50"
								disabled={comboPage === 0}
								onclick={() => (comboPage -= 1)}
							>
								Previous
							</button>
							<span>
								Page {Math.min(comboPage, comboPageCount - 1) + 1} / {comboPageCount} · {filteredCombos.length} combinations
							</span>
							<button
								class="px-3 py-1.5 font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg disabled:opacity-50"
								disabled={comboPage >= comboPageCount - 1}
								onclick={() => (comboPage += 1)}
							>
								Next
							</button>
						</div>
					{/if}
				</div>
			</div>

			<!-- Login trend (from refresh tokens stamped with the login method) -->
			<h4 class="text-sm font-semibold mt-6 mb-1">Logins per method — weekly, last {loginMethods.trend.weeks} weeks</h4>
			<p class="text-xs text-gray-400 mb-4">
				Actual logins, recorded on each new session. Pre-existing sessions have no recorded method and show up as
				"Unknown" until they expire (120-day token TTL).
			</p>
			{#if loginMethods.trend.loginsByWeek.length > 0 && loginMethods.trend.methods.length > 0}
				{@const weeks = loginMethods.trend.loginsByWeek}
				<div class="relative">
					<svg
						viewBox="0 0 {TREND_W} {TREND_H}"
						preserveAspectRatio="none"
						class="w-full h-40"
						role="img"
						aria-label="Logins per method, weekly trend"
						onmousemove={onTrendMove}
						onmouseleave={onTrendLeave}
					>
						{#each loginMethods.trend.methods as method (method)}
							<path
								d={linePath(
									weeks.map((w) => Number(w[method])),
									trendMax,
									TREND_W,
									TREND_H
								)}
								fill="none"
								stroke={trendColor(method)}
								stroke-width="1.5"
								vector-effect="non-scaling-stroke"
							/>
						{/each}
						{#if trendHover !== null}
							{@const x = (trendHover / Math.max(weeks.length - 1, 1)) * TREND_W}
							<line
								x1={x}
								y1={0}
								x2={x}
								y2={TREND_H}
								stroke="currentColor"
								stroke-width="1"
								class="text-gray-300 dark:text-gray-600"
								vector-effect="non-scaling-stroke"
							/>
							{#each loginMethods.trend.methods as method (method)}
								{@const y = TREND_H - (Number(weeks[trendHover][method]) / Math.max(trendMax, 1)) * TREND_H}
								<circle cx={x} cy={y} r="2.5" fill={trendColor(method)} vector-effect="non-scaling-stroke" />
							{/each}
						{/if}
					</svg>
					{#if trendHover !== null && weeks[trendHover]}
						{@const week = weeks[trendHover]}
						<!-- Keep the tooltip inside the chart: anchor left near the cursor, but
						     flip to right-anchored in the last stretch so it doesn't overflow. -->
						<div
							class="absolute top-0 pointer-events-none z-10 px-2.5 py-1.5 bg-gray-900 dark:bg-gray-700 text-white text-[11px] rounded shadow-lg whitespace-nowrap"
							style={trendHoverX > 0.7 ? `right: ${(1 - trendHoverX) * 100}%;` : `left: ${trendHoverX * 100}%;`}
						>
							<div class="font-semibold mb-0.5">{week.week}</div>
							{#each loginMethods.trend.methods as method (method)}
								<div class="flex items-center gap-1.5">
									<span class="inline-block w-2 h-2 rounded-full" style="background: {trendColor(method)}"></span>
									<span class="text-gray-300">{methodLabels[method as Method] ?? method}</span>
									<span class="ml-auto pl-2 font-medium">{Number(week[method] ?? 0)}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
				<div class="flex justify-between mt-1 text-[10px] text-gray-400">
					<span>{weeks[0]?.week ?? ""}</span>
					<span>{weeks[weeks.length - 1]?.week ?? ""}</span>
				</div>
				<div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
					{#each loginMethods.trend.methods as method (method)}
						<span class="flex items-center gap-1.5">
							<span class="inline-block w-2.5 h-2.5 rounded-full" style="background: {trendColor(method)}"></span>
							{methodLabels[method as Method] ?? method}
						</span>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-gray-400">No logins recorded yet.</p>
			{/if}

			<!-- Active sessions per mechanism (live refresh tokens, TTL-bounded) -->
			<h4 class="text-sm font-semibold mt-6 mb-4">Active sessions per mechanism</h4>
			<div class="overflow-x-auto md:w-1/2">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
							<th class="py-2 pr-4">Method</th>
							<th class="py-2 pr-4 text-right">Sessions</th>
							<th class="py-2 text-right">Share</th>
						</tr>
					</thead>
					<tbody>
						{#each Object.entries(loginMethods.sessions).sort((a, b) => b[1] - a[1]) as [method, count] (method)}
							<tr class="border-b border-gray-50 dark:border-gray-800/50">
								<td class="py-2 pr-4 font-medium">{methodLabels[method as Method] ?? method}</td>
								<td class="py-2 pr-4 text-right">{count}</td>
								<td class="py-2 text-right text-gray-500">
									{totalSessions > 0 ? Math.round((count / totalSessions) * 100) : 0}%
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>
