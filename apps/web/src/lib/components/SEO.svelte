<script lang="ts">
  export let title: string = "Boardgamers";
  export let description: string =
    "Play Gaia Project, 6nimmt, Powergrid and Container online. All games and the platform are open source!";
  export let image: string | undefined = undefined;
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:type" content="website" />
  {#if image}
    <meta property="og:image" content={image} />
    <meta property="og:image:width" content="256" />
    <meta property="og:image:height" content="256" />
  {/if}
</svelte:head>
