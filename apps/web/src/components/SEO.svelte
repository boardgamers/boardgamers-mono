<script lang="ts">
  export let title: string = "Boardgamers - Open source online boardgaming";
  export let description: string =
    "Play Gaia Project, 6nimmt, Powergrid and Container online. All games and the platform are open source!";
</script>

<!-- Only show the most recent -->
<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
</svelte:head>
