<script lang="ts">
import { get } from "@/api";
import { Loading, Pagination } from "@/modules/cdk";
import { routePath } from "@/modules/router";
import { createWatcher, handleError, pluralize } from "@/utils";

export let boardgameId: string;
export let top = false;
export let perPage = 5;

let count = 0;
let currentPage = 0;
let boardgameElo: any[] = [];
let loading = true;

$: title = top ? "Top ranked players": "Elo"

async function load(refresh: boolean) {
  const baseURL = `/boardgame/${boardgameId}/elo`;

  try {
    if (refresh) {
      loading = true;

      if (!top) {
        count = await get(`${baseURL}/count`);
      }
    }

    boardgameElo = await get(baseURL, { skip: currentPage * perPage, count: perPage});
  } catch (err) {
    handleError(err);
  } finally {
    loading = false;
  }
}

$: load(true), [boardgameId]

const onPageChange = createWatcher(() => load(false))

$: onPageChange(currentPage)
</script>

<div>
  <h3>{title}</h3>
  <Loading {loading}>
    <ul class="list-group text-left">
      {#each boardgameElo as bgElo, pos}
        <a
          href={routePath({ name: "user", params: { username: bgElo.userData[0].account.username }, hash: "elo" })}
          class="list-group-item list-group-item-action"
        >
          <span>
            <b>{pos + 1 + currentPage * 10}</b> - {bgElo.userData[0].account.username} -
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
