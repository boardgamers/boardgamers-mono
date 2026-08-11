<!-- Test stub for icon components (and any leaf child using `$props()` rest-spread),
     which crash when mounted with empty props in the jsdom/svelte vitest env. Renders a
     plain span so component specs can exercise their parent without the icon's SVG. -->
<script lang="ts">
	let { class: className = "" }: { class?: string } = $props();
</script>

<span class={className} data-icon-stub></span>
