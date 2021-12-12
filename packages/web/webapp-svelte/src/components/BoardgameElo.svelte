<script lang="ts">
  import { EloRanking, useEloRankings } from "@/composition/useEloRankings";

  import { useRest } from "@/composition/useRest";
  import { Loading, Pagination } from "@/modules/cdk";
  import { createWatcher, handleError, pluralize } from "@/utils";
  import { init } from "svelte/internal";

  const { get } = useRest();

  export let boardgameId: string;
  export let top = false;
  export let perPage = 5;
  export let initial: { rankings: EloRanking[]; total: number } | void = undefined;

  let count = initial?.total ?? 0;
  let currentPage = 0;
  let boardgameElo: EloRanking[] = initial?.rankings ?? [];
  let loading = !initial;

  const { loadEloRankings } = useEloRankings();

  $: title = top ? "Top ranked players" : "Elo";

  async function load(refresh: boolean) {
    try {
      loading = true;
      const result = await loadEloRankings({
        boardgameId,
        count: perPage,
        skip: currentPage * perPage,
        fetchCount: !top && refresh,
      });

      boardgameElo = result.rankings;
      count = result.total;
    } catch (err) {
      handleError(err);
    } finally {
      loading = false;
    }
  }

  const reload = createWatcher(() => load(true), { immediate: !initial });

  $: reload(), [boardgameId];

  const onPageChange = createWatcher(() => load(false));

  $: onPageChange(), [currentPage];
</script>

<div>
  <h3>{title}</h3>
  <Loading {loading}>
    <ul class="list-group text-start">
      {#each boardgameElo as bgElo, pos}
        <a href={`/user/${bgElo.user.name}#elo`} class="list-group-item list-group-item-action">
          <span>
            <b>{pos + 1 + currentPage * 10}</b> - {bgElo.user.name} -
            <b>{bgElo.elo.value}</b> elo in {pluralize(bgElo.elo.games, "game")}
          </span>
        </a>
      {/each}
    </ul>
    {#if !top}
      <Pagination class="mt-1" align="right" {count} bind:currentPage {perPage} />
    {/if}
  </Loading>
</div>
