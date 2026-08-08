import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// VITE_backend locates the api service in multi-instance dev (one loopback IP per
// instance — see AGENTS.md "Running instances"); the game-server is on the same host.
const backend = (process.env.VITE_backend ?? "127.0.0.1").replace(/^https?:\/\//, "").replace(/:\d+$/, "");

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5180,
		proxy: {
			"/api/gameplay": {
				target: `http://${backend}:50803`,
				changeOrigin: true,
			},
			"/api": {
				target: `http://${backend}:50801`,
				changeOrigin: true,
			},
		},
	},
});
