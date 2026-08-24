<script lang="ts">
	// Minimal consumer of `m.*` for messages-live-switch.spec.svelte.ts — a plain
	// render-time message call, the pattern every translated component uses.
	import { m } from "./messages";
</script>

<p data-testid="probe">{m.gameList_noGames()}</p>
