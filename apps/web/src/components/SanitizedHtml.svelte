<script lang="ts">
	import { sanitizeHtml } from "@/lib/sanitize";

	let { html }: { html: string } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- server renders the attribute, client mounts the fragment -->
{@html sanitizeHtml(html)}
