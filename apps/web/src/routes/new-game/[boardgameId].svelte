<script context="module" lang="ts">
  import type { LoadInput } from "@sveltejs/kit";

  export function load(input: LoadInput) {
    return {
      redirect: `/boardgame/${input.params.boardgameId}/new-game`,
      status: 301,
    };
  }
</script>
