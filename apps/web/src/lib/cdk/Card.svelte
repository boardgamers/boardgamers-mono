<script lang="ts">
  import { Card, CardBody, CardFooter, CardHeader } from "@sveltestrap/sveltestrap";

  export let header = "";
</script>

<Card {...$$props} onclick>
  {#if header || $$slots.header}
    <CardHeader>
      <slot name="header">
        {header}
      </slot>
    </CardHeader>
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
