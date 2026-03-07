import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5180,
		proxy: {
			"/api/gameplay": {
				target: "http://localhost:50803",
				changeOrigin: true,
			},
			"/api": {
				target: "http://localhost:50801",
				changeOrigin: true,
			},
		},
	},
});
