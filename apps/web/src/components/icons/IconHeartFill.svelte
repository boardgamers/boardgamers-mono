<script lang="ts">
	let {
		class: className = "",
		style = "",
		size = "1em",
		...rest
	}: { class?: string; style?: string; size?: string; [key: string]: any } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 16 16"
	width={size}
	height={size}
	fill="currentColor"
	class={className}
	{style}
	aria-hidden="true"
	{...rest}
>
	<path fill-rule="evenodd" d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314" />
</svg>
