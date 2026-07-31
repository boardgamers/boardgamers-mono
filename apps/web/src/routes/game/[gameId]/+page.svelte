<script lang="ts">
  import { OpenGame, StartedGame, ChatRoom, YourTurnBanner } from "@/components";
  import type { GameFront, PlayerInfoFront, GameInfoFront } from "@bgs/models";
  import { page } from "$app/state";

  let game = $derived((page.data.game as GameFront)!);
  let gameId = $derived(game._id);
</script>

<YourTurnBanner />

{#if game.status === "open"}
  <OpenGame />
{:else}
  <StartedGame />
{/if}
<ChatRoom room={gameId} />
