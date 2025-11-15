<script lang="ts">
  import { classnames } from "$lib/utils/classname";
  import { Pagination, PaginationItem, PaginationLink } from "@sveltestrap/sveltestrap";

  export let align: "right" | "left" | "center" | undefined = undefined;
  export let title = "Pagination";
  export let count: number;
  export let perPage: number;
  export let currentPage = 0;
  export let baseUrl: string | undefined = undefined;
  let className = "";
  export { className as class };
  let classes: string;

  // Should always be odd-numbered
  const pageItems = 5;

  $: classes = classnames(
    align ? ["d-flex", `justify-content-${{ right: "end", center: "center", left: "start" }[align]}`] : "",
    className
  );

  let totalPages: number;
  $: totalPages = Math.max(1, Math.ceil(count / perPage));

  function pageFor(position: number) {
    const pos = Math.min(
      Math.max(position, currentPage + (position - (pageItems - 1) / 2)),
      totalPages + position - pageItems
    );

    if (position === pageItems - 1 && pos + 1 < totalPages) {
      return "…";
    }

    if (position === 0 && pos > 0) {
      return "…";
    }

    return pos;
  }
</script>

<Pagination arialabel={title} class={classes}>
  <PaginationItem disabled={currentPage === 0}>
    <PaginationLink
      first
      href={baseUrl ? `${baseUrl}/1` : "#first"}
      onclick={(e) => {
        e.preventDefault();
        currentPage = 0;
      }}
    />
  </PaginationItem>
  <PaginationItem disabled={currentPage === 0}>
    <PaginationLink
      previous
      href={baseUrl ? `${baseUrl}/${currentPage}` : "#previous"}
      onclick={(e) => {
        e.preventDefault();
        currentPage -= 1;
      }}
    />
  </PaginationItem>
  {#each Array(pageItems) as _, position (pageFor(position) + "_" + position)}
    {#if !(pageFor(position) < 0)}
      <PaginationItem disabled={typeof pageFor(position) !== "number"} active={pageFor(position) === currentPage}>
        <PaginationLink
          href={baseUrl ? `${baseUrl}/${+pageFor(position) + 1}` : "#"}
          onclick={!baseUrl
            ? (e) => {
                e.preventDefault();
                currentPage = +pageFor(position);
              }
            : () => {}}
          arialabel={typeof pageFor(position) === "number" ? `Go to page ${+pageFor(position) + 1}` : undefined}
        >
          {typeof pageFor(position) === "number" ? +pageFor(position) + 1 : pageFor(position)}
        </PaginationLink>
      </PaginationItem>
    {/if}
  {/each}
  <PaginationItem disabled={currentPage === totalPages - 1}>
    <PaginationLink
      next
      href={baseUrl ? `${baseUrl}/${currentPage + 2}` : "#next"}
      onclick={(e) => {
        e.preventDefault();
        currentPage += 1;
      }}
    />
  </PaginationItem>
  <PaginationItem disabled={currentPage === totalPages - 1}>
    <PaginationLink
      last
      href={baseUrl ? `${baseUrl}/${totalPages}` : "#last"}
      onclick={(e) => {
        e.preventDefault();
        currentPage = totalPages - 1;
      }}
    />
  </PaginationItem>
</Pagination>
