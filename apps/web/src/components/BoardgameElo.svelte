<script lang="ts">
  import { loadEloRankings, type EloRanking } from "@/lib/elo-rankings.svelte";
  import { Loading, Pagination } from "@/modules/cdk";
  import { createWatcher, handleError, pluralize } from "@/utils";
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

  let count = $state(initial?.total ?? 0);
  let boardgameElo = $state<EloRanking[]>(initial?.rankings ?? []);
  let loading = $state(!initial);

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

  const reload = createWatcher(() => load(true), { immediate: !initial });

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
    <ul class="list-group text-start">
      {#each boardgameElo as bgElo, pos}
        <a href={`/user/${bgElo.user.name}#elo`} class="list-group-item list-group-item-action">
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
