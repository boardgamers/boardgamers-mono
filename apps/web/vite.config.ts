import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { execSync } from "node:child_process";

// VITE_backend locates the api service; the gameplay/ws/resources backends default to
// the same host on their standard ports, so multi-instance dev (one loopback IP per
// instance, default ports — see AGENTS.md "Running instances") only sets the one
// variable. Per-service escape hatches: VITE_backend_api / VITE_backend_gameplay /
// VITE_backend_ws / VITE_backend_resources (each host or host:port).
// Proxy targets always need explicit ports.
const withPort = (hostPort: string, port: number) => {
	const raw = hostPort.replace(/^https?:\/\//, "");
	// Bare IPv6 (multiple colons, no brackets) has no port — a naive split on ":"
	// would shred it. Otherwise split host:port on the last colon only. Mirrors
	// backendUrl() in src/hooks.server.ts.
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
	const p = idx === -1 ? undefined : raw.slice(idx + 1);
	// Port 443 means TLS (e.g. proxying to a preview/prod host).
	const proto = (p ?? String(port)) === "443" ? "https" : "http";
	const ip = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
	return `${proto}://${ip}:${p ?? port}`;
};

const backend = withPort(process.env.VITE_backend_api ?? process.env.VITE_backend ?? "127.0.0.1", 50801);
const gameplayBackend = withPort(process.env.VITE_backend_gameplay ?? process.env.VITE_backend ?? "127.0.0.1", 50803);
const wsBackend = withPort(process.env.VITE_backend_ws ?? process.env.VITE_backend ?? "127.0.0.1", 50802);
const resourcesBackend = withPort(
	process.env.VITE_backend_resources ?? process.env.VITE_backend ?? "127.0.0.1",
	50804,
).replace("www.", "resources.");

// Stamp a release id (git SHA, else package version) into the client bundle so error
// reports can be tied to a specific build — invaluable during a migration.
const release =
	process.env.APP_RELEASE ??
	(() => {
		try {
			return execSync("git rev-parse --short HEAD").toString().trim();
		} catch {
			return process.env.npm_package_version ?? "dev";
		}
	})();

export default defineConfig({
	define: {
		__APP_RELEASE__: JSON.stringify(release),
	},
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 8612,
		proxy: {
			"/ws": {
				target: wsBackend,
				changeOrigin: true,
				ws: true,
			},
			"/api/gameplay": {
				target: gameplayBackend,
				changeOrigin: true,
			},
			"/api": {
				target: backend,
				changeOrigin: true,
			},
			"/resources": {
				target: resourcesBackend,
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/resources/, ""),
			},
		},
	},
});
