<script lang="ts">
  import { Card, CardHeader, CardBody } from "sveltestrap"

  export let header = "";
</script>

<Card {...$$props}>
  {#if header}
    <CardHeader>{header}</CardHeader>
  {/if}
  <CardBody>
    <slot />
  </CardBody>
</Card>
