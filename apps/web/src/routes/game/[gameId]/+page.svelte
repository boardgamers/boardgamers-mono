<script lang="ts">
  import { OpenGame, StartedGame, ChatRoom } from "@/components";
  import type { GameFront, PlayerInfoFront, GameInfoFront } from "@bgs/models";
  import { page } from "$app/stores";

  let game = $derived(($page.data.game as GameFront)!);
  let gameId = $derived(game._id);
</script>

{#if game.status === "open"}
  <OpenGame />
{:else}
  <StartedGame />
{/if}
<ChatRoom room={gameId} />
