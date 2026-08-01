<script lang="ts">
  import { getContext } from "svelte";
  import { keyBy } from "lodash";
  import type { GameContext } from "@/routes/game/[gameId]/game-context";
  import { account } from "@/lib/stores.svelte";

  const context: GameContext = getContext("game");

  let userId = $derived($account?._id);
  let currentPlayersById = $derived(keyBy(context.game?.currentPlayers ?? [], "_id"));

  // It's the player's turn when the game is active and they're among the current players.
  let isMyTurn = $derived(!!userId && context.game?.status === "active" && !!currentPlayersById[userId]);
</script>

{#if isMyTurn}
  <!-- In-flow full-bleed bar sitting directly above the game board. The negative top
       margin cancels the Appbar's mb-3 so the banner is flush under the navbar. -->
  <div
    class="your-turn-banner -mt-3 flex items-center justify-center gap-2 bg-green-600 px-4 py-2 text-center font-semibold text-white shadow-md"
    role="status"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="currentColor"
      class="shrink-0"
    >
      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
      <path
        d="M8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4m.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2"
      />
    </svg>
    Your turn — make a move!
  </div>
{/if}
