<script lang="ts">
	import OGCard from "@/components/OG/OGCard.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
</svelte:head>

<OGCard title={data.title} subtitle={data.subtitle} />
