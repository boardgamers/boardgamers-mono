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

  // Single URL for all avatars. The backend handles:
  //  - uploaded avatars (with ETag for conditional requests → 304 if unchanged)
  //  - dicebear generated avatars (cached for 24h, deterministic by username+style)
  // No cache busters, no tokens, no updatedAt — the browser handles caching.
  let src = $derived(
    userId ? `/api/user/${userId}/avatar` : `https://avatars.dicebear.com/api/${art}/${username}.svg?r=0`
  );
</script>

<img
  {src}
  srcset="{src}?size=256 256w, {src}?size=128 128w, {src}?size=64 64w"
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
