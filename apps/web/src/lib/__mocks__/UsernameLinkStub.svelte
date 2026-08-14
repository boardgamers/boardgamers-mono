<!-- Test stub for UsernameLink: the real one spreads `...rest` onto its anchor and
     lazily renders a hover UserCard, neither of which works in the jsdom/svelte
     vitest env (same leaf `$props()` rest-spread issue as IconStub). Renders a plain
     anchor so component specs can exercise their parent. -->
<script lang="ts">
	let {
		username,
		class: className = "",
		children,
	}: { username: string; userId?: string | null; class?: string; children?: import("svelte").Snippet } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- test stub: $app/paths resolves to a partial mock, and specs never follow links -->
<a href="/user/{username}" class={className}
	>{#if children}{@render children()}{:else}{username}{/if}</a
>
