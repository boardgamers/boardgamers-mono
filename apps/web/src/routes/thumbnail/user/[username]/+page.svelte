<script lang="ts">
	import OGCard from "@/components/OG/OGCard.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
</script>

<OGCard {...data.card} />
