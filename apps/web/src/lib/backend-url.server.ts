/**
 * Backend address resolution shared by the SSR fetch hook (hooks.server.ts) and the
 * /auth proxy route. `VITE_backend` (host or host:port — same var as vite.config.ts)
 * locates the api service; the other backends default to the same host on their
 * standard ports. Per-service escape hatches: VITE_backend_api / VITE_backend_gameplay.
 */
export function backendUrl(override: string | undefined, defaultPort: number): string {
	const raw = (override ?? import.meta.env.VITE_backend ?? "127.0.0.1").replace(/^https?:\/\//, "");
	// Bare IPv6 (contains multiple colons, no brackets) has no port — a naive split(":")
	// would shred it. Otherwise split host:port on the last colon only.
	const isBareIpv6 = !raw.startsWith("[") && (raw.match(/:/g)?.length ?? 0) > 1;
	// A bracketed IPv6 literal keeps its brackets; only a "]:" suffix is a port.
	const idx = isBareIpv6
		? -1
		: raw.startsWith("[")
			? raw.indexOf("]:") === -1
				? -1
				: raw.indexOf("]:") + 1
			: raw.lastIndexOf(":");
	const host = idx === -1 ? raw : raw.slice(0, idx);
	const port = idx === -1 ? undefined : raw.slice(idx + 1);
	const ip = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
	// Port 443 means TLS — lets SSR fetch a preview/prod API over https.
	const proto = (port ?? String(defaultPort)) === "443" ? "https" : "http";
	return `${proto}://${ip}:${port ?? defaultPort}`;
}
