<!-- Test stub for the CDK Loading component (its Spinner crashes when mounted in the
     jsdom/svelte vitest env, same class of issue as IconStub/BadgeStub). Renders
     nothing — the specs only need the rest of the tree. -->
<script lang="ts">
	let { loading = false }: { loading?: boolean } = $props();
</script>

{#if loading}<span data-loading-stub></span>{/if}
