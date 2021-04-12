<script lang="ts">
  import { Card, CardHeader, CardBody, CardFooter } from "sveltestrap"

  export let header = "";
</script>

<Card {...$$props} on:click>
  {#if header}
    <CardHeader>{header}</CardHeader>
  {/if}
  <CardBody>
    <slot />
  </CardBody>
  {#if $$slots.footer}
    <CardFooter>
      <slot name="footer" />
    </CardFooter>
  {/if}
</Card>
