<script lang="ts">
	let {
		userId = null,
		username,
		art = "pixel-art",
		size = "4rem",
		class: className = "",
		onclick,
		onerror,
		onload,
		...rest
	}: {
		userId?: string | null;
		username: string;
		art?: string;
		size?: string;
		class?: string;
		onclick?: (e: MouseEvent) => void;
		onerror?: (e: Event) => void;
		onload?: (e: Event) => void;
		[key: string]: any;
	} = $props();

	// All avatars are served by our api (nothing external):
	//  - uploaded avatars (with ETag for conditional requests → 304 if unchanged)
	//  - dicebear avatars generated locally (cached for 24h, deterministic by username+style)
	// With a userId the user's chosen style applies; otherwise `art` picks the style
	// (used by the account-page style picker, which only knows the username).
	// No cache busters, no tokens, no updatedAt — the browser handles caching.
	let src = $derived(
		userId
			? `/api/user/${userId}/avatar`
			: `/api/user/byName/${encodeURIComponent(username)}/avatar?style=${encodeURIComponent(art)}`
	);
	// Sized variants for srcset — `?size=` on the raw src would produce
	// "…?style=x?size=64" (unparseable), so build each variant with URL.
	let sized = $derived((size: number) => {
		const url = new URL(src, "http://local");
		url.searchParams.set("size", String(size));
		return url.pathname + url.search;
	});
</script>

<img
	{src}
	srcset="{sized(256)} 256w, {sized(128)} 128w, {sized(64)} 64w"
	sizes={size}
	style="height: {size}; width: {size}"
	alt={`${username}'s avatar`}
	title={username}
	{...rest}
	class={["user-avatar", className].filter(Boolean).join(" ")}
	{onclick}
	{onerror}
	{onload}
/>

<style>
	.user-avatar {
		border-radius: 50%;
		border: var(--avatar-border, 1px solid rgb(156 163 175)); /* gray-400 default */
		background-color: rgb(229 231 235); /* gray-200 */
		object-fit: cover; /* crop square uploads into the circle */
	}

	/* :global(.dark) ancestor — kept in the scoped block so specificity matches .user-avatar. */
	:global(.dark) .user-avatar {
		background-color: rgb(31 41 55); /* gray-800 */
		border: var(--avatar-border, 1px solid rgb(75 85 99)); /* gray-600 default */
	}
</style>
