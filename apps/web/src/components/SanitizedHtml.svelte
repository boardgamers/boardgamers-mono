<script lang="ts">
	// isomorphic-dompurify: native DOMPurify in the browser, jsdom-backed on the server,
	// so sanitization also runs during SSR (plain `dompurify` has no `window` there).
	import DOMPurify from "isomorphic-dompurify";
	import type { HTMLAttributes } from "svelte/elements";

	type Props = {
		html: string;
	} & HTMLAttributes<HTMLElement>;

	let { html, ...rest }: Props = $props();
</script>

<span {...rest}>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- server renders the attribute, client mounts the fragment -->
	{@html DOMPurify.sanitize(html)}</span
>
