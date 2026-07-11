<script lang="ts">
  import { classnames } from "@/utils";
  import PaginationItem from "./PaginationItem.svelte";
  import PaginationLink from "./PaginationLink.svelte";

  let {
    align = undefined,
    title = "Pagination",
    count = 0,
    perPage = 10,
    currentPage = $bindable(0),
    baseUrl = undefined,
    class: className = "",
  }: {
    align?: "right" | "left" | "center";
    title?: string;
    count?: number;
    perPage?: number;
    currentPage?: number;
    baseUrl?: string;
    class?: string;
  } = $props();

  // Should always be odd-numbered
  const pageItems = 5;

  let classes = $derived(
    classnames(
      "pagination",
      align ? ["d-flex", `justify-content-${{ right: "end", center: "center", left: "start" }[align]}`] : "",
      className
    )
  );

  let totalPages = $derived(Math.max(1, Math.ceil(count / perPage)));

  function pageFor(position: number): number | string {
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

<ul class={classes} aria-label={title}>
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
      <PaginationItem
        disabled={typeof pageFor(position) !== "number"}
        active={pageFor(position) === currentPage}
      >
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
</ul>
