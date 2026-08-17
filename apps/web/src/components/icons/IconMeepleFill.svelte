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
	<!-- Original meeple silhouette (head + outstretched arms + two-footed base). -->
	<path
		d="M8 1a1.75 1.75 0 1 0 0 3.5A1.75 1.75 0 0 0 8 1zM2.9 4.6c-.5 0-.8.5-.6 1l.9 1.6c.2.3.5.5.9.5h1.1l-.9 5.5c-.1.6.4 1.1 1 1.1h5.4c.6 0 1.1-.5 1-1.1l-.9-5.5h1.1c.4 0 .7-.2.9-.5l.9-1.6c.2-.5-.1-1-.6-1H2.9z"
	/>
</svg>
