<script lang="ts">
  import { oneLineMarked } from "@/utils";
  import { Badge } from "@/modules/cdk";
  import type { GameInfoFront } from "@bgs/models";
  import type { JsonValue } from "type-fest";

  // A setup-option badge that renders any markdown (including links) with white
  // link text, matching the game-sidebar badge style. Used by both the game sidebar
  // and the open-game lobby so they render setup options identically.
  let {
    pref,
    value,
    color = "secondary",
  }: {
    pref: NonNullable<GameInfoFront["options"]>[number];
    value: unknown;
    color?: string;
  } = $props();

  let label = $derived.by(() => {
    if (pref.type === "checkbox") {
      return pref.label;
    }
    if (pref.type === "select" && pref.items) {
      const item = pref.items.find((x) => x.name === (value as JsonValue));
      if (item) {
        return `${pref.label}: ${item.label}`;
      }
    }
    return null;
  });
</script>

{#if label}
  <Badge {color} class="setup-badge">{@html oneLineMarked(label)}</Badge>
{/if}
