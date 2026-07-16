<script lang="ts">
  import { loadEloRankings, type EloRanking } from "@/lib/elo-rankings.svelte";
  import { Loading, Pagination } from "@/modules/cdk";
  import { createWatcher, handleError, pluralize } from "@/utils";
  import { untrack } from "svelte";
  import UserAvatar from "./User/UserAvatar.svelte";

  let {
    boardgameId,
    top = false,
    perPage = 5,
    baseUrl = undefined,
    initial = undefined,
    currentPage = $bindable(0),
  }: {
    boardgameId: string;
    top?: boolean;
    perPage?: number;
    baseUrl?: string | undefined;
    initial?: { rankings: EloRanking[]; total: number } | void;
    currentPage?: number;
  } = $props();

  // Seed from SSR data once — `initial` is a one-shot prop that never changes after mount.
  let count = $state(untrack(() => initial?.total ?? 0));
  let boardgameElo = $state<EloRanking[]>(untrack(() => initial?.rankings ?? []));
  let loading = $state(untrack(() => !initial));

  let title = $derived(top ? "Top ranked players" : "Elo");

  async function load(refresh: boolean) {
    try {
      const result = await loadEloRankings({
        boardgameId,
        count: perPage,
        skip: currentPage * perPage,
        fetchCount: !top && refresh,
      });

      boardgameElo = result.rankings;
      count = refresh ? result.total : count;
    } catch (err) {
      handleError(err);
    } finally {
      loading = false;
    }
  }

  const hasInitial = untrack(() => initial !== undefined);
  const reload = createWatcher(() => load(true), { immediate: !hasInitial });

  $effect(() => {
    boardgameId;
    reload();
  });

  const onPageChange = createWatcher(() => !baseUrl && load(false));

  $effect(() => {
    if (baseUrl && initial) {
      boardgameElo = initial.rankings;
    }
  });

  $effect(() => {
    currentPage;
    onPageChange();
  });
</script>

<div>
  <h3>{title}</h3>
  <Loading {loading}>
    <ul class="divide-y divide-accent/80 rounded-lg border border-accent/80 bg-white text-left dark:divide-accent/60 dark:border-accent/60 dark:bg-gray-900">
      {#each boardgameElo as bgElo, pos}
        <a
          href={`/user/${bgElo.user.name}#elo`}
          class="flex items-center px-4 py-2 no-underline text-inherit hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <UserAvatar username={bgElo.user.name} userId={bgElo.user._id} size="2rem" />
          <span class="ms-2">
            <b>{pos + 1 + currentPage * perPage}</b> - {bgElo.user.name} -
            <b>{bgElo.elo.value}</b> elo in {pluralize(bgElo.elo.games, "game")}
          </span>
        </a>
      {/each}
    </ul>
    {#if !top}
      <Pagination class="mt-1" align="right" {count} bind:currentPage {baseUrl} {perPage} />
    {/if}
  </Loading>
</div>
