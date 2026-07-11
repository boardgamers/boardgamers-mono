<script lang="ts">
  import { browser } from "$app/environment";

  import { imageCache } from "@/lib/stores.svelte";
  import { getAccessToken } from "@/lib/api";

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

  let token = $state<string>();

  if (browser) {
    getAccessToken("/api/account/avatar").then((res) => (token = res?.code!));
  }

  let src = $derived(
    userId === "me"
      ? `/api/account/avatar?d=${$imageCache}&token=${encodeURIComponent(token)}`
      : userId
        ? `/api/user/${userId}/avatar?d=${$imageCache}`
        : `https://avatars.dicebear.com/api/${art}/${username}.svg?r=0`
  );
</script>

<img
  {src}
  srcset="{src}&size=256 256w, {src}&size=128 128w, {src}&size=64 64w"
  sizes={size}
  style="height: {size}; width: ${size}"
  alt={`${username}'s avatar`}
  title={username}
  class="user-avatar"
  {...rest}
  {onclick}
  {onerror}
  {onload}
/>

<style>
  .user-avatar {
    border-radius: 50%;
    border: var(--avatar-border);
  }
</style>
