<script lang="ts">
  import { browser } from "$app/env";

  import { useImageCache } from "@/composition/useImageCache";
  import { useRest } from "@/composition/useRest";

  const { getAccessToken } = useRest();
  const { imageCache } = useImageCache();

  export let userId: string | null = null;
  export let username: string;
  export let art = "pixel-art";

  export let size = "4rem";

  let src: string;
  let token: string;

  if (browser) {
    getAccessToken("/api/account/avatar").then((res) => (token = res?.code!));
  }

  $: src =
    userId === "me"
      ? `/api/account/avatar?d=${$imageCache}&token=${encodeURIComponent(token)}`
      : userId
      ? `/api/user/${userId}/avatar?d=${$imageCache}`
      : `https://avatars.dicebear.com/api/${art}/${username}.svg?r=0`;
</script>

<img
  {src}
  srcset="{src}&size=256 256w, {src}&size=128 128w, {src}&size=64 64w"
  sizes={size}
  style="height: {size}; width: ${size}"
  alt={`${username}'s avatar`}
  title={username}
  class="user-avatar"
  {...$$restProps}
  on:click
  on:error
  on:load
/>

<style>
  .user-avatar {
    border-radius: 50%;
    border: var(--avatar-border);
  }
</style>
