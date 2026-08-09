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
	// Non-greedy host so an optional :port suffix is captured — a greedy split on
	// ":" would shred bare IPv6 literals. Port 443 means TLS (e.g. proxying to a
	// preview/prod host).
	const m = hostPort.replace(/^https?:\/\//, "").match(/^(.+?)(?::(\d+))?$/);
	const host = m?.[1] ?? hostPort;
	const p = m?.[2];
	const proto = p === "443" ? "https" : "http";
	const needsBrackets = host.includes(":") && !host.startsWith("["); // bare IPv6 literal
	return `${proto}://${needsBrackets ? `[${host}]` : host}:${p ?? port}`;
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
