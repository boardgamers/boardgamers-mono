<script lang="ts">
  export let title: string = "Boardgamers";
  export let description: string = "Play Gaia Project, 6nimmt, Powergrid and Container online";
</script>

<!-- Only show the most recent -->
<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
</svelte:head>
