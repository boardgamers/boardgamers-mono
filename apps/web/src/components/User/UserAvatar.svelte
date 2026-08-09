<script lang="ts">
	let {
		userId = null,
		username,
		art = "pixel-art",
		size = "4rem",
		v = null,
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
		// Optional local cache-buster appended as ?v=… — the account page passes its
		// avatarReload counter to force the just-changed avatar to show instantly.
		// Elsewhere it's omitted: ETag + no-cache revalidation keeps avatars fresh.
		v?: string | number | null;
		class?: string;
		onclick?: (e: MouseEvent) => void;
		onerror?: (e: Event) => void;
		onload?: (e: Event) => void;
		[key: string]: any;
	} = $props();

	// All avatars are served by our api (nothing external), with ETag + `no-cache`
	// so the browser always revalidates: 304 when unchanged (no re-download), the
	// fresh image as soon as the style or upload changes — no hard refresh needed.
	// With a userId the user's chosen style applies; otherwise `art` picks the style
	// (used by the account-page style picker, which only knows the username).
	let src = $derived(
		withParams(
			userId
				? `/api/user/${userId}/avatar`
				: `/api/user/byName/${encodeURIComponent(username)}/avatar?style=${encodeURIComponent(art)}`,
			v != null ? { v: String(v) } : {}
		)
	);

	function withParams(path: string, params: Record<string, string>): string {
		const url = new URL(path, "http://local");
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}
		return url.pathname + url.search;
	}

	// Sized variants for srcset — build with URL so `?size=` is well-formed even
	// when the src already has a query (e.g. ?style=).
	let sized = $derived((size: number) => withParams(src, { size: String(size) }));
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
