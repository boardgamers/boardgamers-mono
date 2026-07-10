import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5180,
		proxy: {
			"/api/gameplay": {
				// 127.0.0.1, not localhost: the dev servers bind 127.0.0.1 and on hosts
				// where localhost → ::1 first, dialing localhost hits a refused IPv4 socket.
				target: "http://127.0.0.1:50803",
				changeOrigin: true,
			},
			"/api": {
				target: "http://127.0.0.1:50801",
				changeOrigin: true,
			},
		},
	},
});
