<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { loadGames } from "$lib/stores.svelte.ts";
	import GameEdit, { type GameInfoData } from "$components/GameEdit.svelte";

	let value: GameInfoData = $state({
		label: "",
		// null (not undefined) so a new game without an alias still sends the field —
		// the API unsets null-valued clearable fields.
		alias: null,
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
		needOwnership: true,
		public: false,
	});

	async function save(data: GameInfoData) {
		// The Game ID input already trims on paste/blur (use:trim), so data._id is clean.
		const game = data._id?.game;
		const version = data._id?.version;
		if (!game) {
			toast.error("Game ID is required");
			return;
		}
		if (!version) {
			toast.error("Version is required");
			return;
		}
		try {
			await api.post(`/admin/gameinfo/${encodeURIComponent(game)}/${version}`, data);
			toast.success("Game created");
			await loadGames();
			goto(resolve("/game/[game]/[version]", { game, version: String(version) }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to create");
		}
	}
</script>

<div>
	<h2 class="text-xl font-bold mb-6">New Boardgame</h2>
	<GameEdit mode="new" bind:value onsave={save} />
</div>
