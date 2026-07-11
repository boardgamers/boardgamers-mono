<script lang="ts">
  let {
    userId = null,
    username,
    art = "pixel-art",
    size = "4rem",
    onclick,
    onerror,
    onload,
    ...rest
  }: {
    userId?: string | null;
    username: string;
    art?: string;
    size?: string;
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
  srcset="{src}&size=256 256w, {src}&size=128 128w, {src}&size=64 64w"
  sizes={size}
  style="height: {size}; width: {size}"
  alt={`${username}'s avatar`}
  title={username}
  class="user-avatar"
  {onclick}
  {onerror}
  {onload}
  {...rest}
/>

<style>
  .user-avatar {
    border-radius: 50%;
    border: var(--avatar-border);
  }
</style>
