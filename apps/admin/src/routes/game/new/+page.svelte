<script lang="ts">
	import { goto } from "$app/navigation";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { loadGames } from "$lib/stores.svelte.ts";
	import GameEdit, { type GameInfoData } from "$components/GameEdit.svelte";

	let value: GameInfoData = $state({
		label: "",
		description: "",
		rules: "",
		viewer: {
			url: "//cdn.jsdelivr.net/npm/@boardgamers/<game>-viewer@^1/dist/<game>-viewer.umd.min.js",
			topLevelVariable: "",
			dependencies: {
				scripts: [],
				stylesheets: ["//cdn.jsdelivr.net/npm/@boardgamers/<game>-viewer@1.0.2/dist/<game>-viewer.css"],
			},
			fullScreen: false,
			replayable: false,
			trusted: false,
			alternate: {
				url: "",
				topLevelVariable: "",
				dependencies: { scripts: [], stylesheets: [] },
				fullScreen: false,
				replayable: false,
				trusted: false,
			},
		},
		engine: {
			package: { name: "", version: "" },
			entryPoint: "dist/wrapper.js",
		},
		factions: { avatars: false },
		preferences: [],
		options: [],
		settings: [],
		players: [2, 3, 4],
		expansions: [],
		meta: { public: false, needOwnership: true },
	});

	async function save(data: GameInfoData) {
		if (!data._id?.game) {
			toast.error("Game ID is required");
			return;
		}
		try {
			await api.post(`/admin/gameinfo/${data._id.game}/${data._id.version}`, data);
			toast.success("Game created");
			await loadGames();
			goto(`/game/${data._id.game}/${data._id.version}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to create");
		}
	}
</script>

<div>
	<h2 class="text-xl font-bold mb-6">New Boardgame</h2>
	<GameEdit mode="new" bind:value onsave={save} />
</div>
