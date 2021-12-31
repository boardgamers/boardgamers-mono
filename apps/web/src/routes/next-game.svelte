<script context="module" lang="ts">
  import { useActiveGames } from "@/composition/useActiveGames";
  import { useLoad } from "@/composition/useLoad";
  import { get as storeGet } from "svelte/store";

  import type { LoadInput } from "@sveltejs/kit";
  import { useAccount } from "@/composition/useAccount";
  import { redirectLoggedIn } from "@/utils/redirect";

  export async function load(input: LoadInput) {
    const { activeGames, account } = useLoad(input, useActiveGames, useAccount);

    if (!storeGet(account)) {
      return {
        redirect: redirectLoggedIn(input.url),
        status: 302,
      };
    }

    if (storeGet(activeGames).length === 0) {
      return {
        redirect: `/user/${storeGet(account)!.account.username}#active`,
        status: 302,
      };
    }

    const games = storeGet(activeGames);
    const currentIdx = games.indexOf(input.params.gameId);
    const gameId = games[(currentIdx + 1) % games.length];

    return {
      redirect: `/game/${gameId}`,
      status: 302,
    };
  }
</script>
