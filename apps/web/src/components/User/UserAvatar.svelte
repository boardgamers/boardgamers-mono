<script lang="ts">
import { browser } from "$app/env";

  import { useAccount } from "@/composition/useAccount";
  import { useRest } from "@/composition/useRest";

  const { account } = useAccount();
  const { getAccessToken } = useRest();

  export let userId: string | null = null;
  export let username: string;
  export let art = "pixel-art";

  let src: string;
  let token: string; 
  
  if (browser) {
    getAccessToken("/api/account/avatar").then((res) => token = res?.code!)
  };

  $: src = userId === "me" ? `/api/account/avatar?d=${Date.now()}&token=${token}` : userId
    ? `/api/user/${userId}/avatar?d=${$account?.account.avatar}`
    : `https://avatars.dicebear.com/api/${art}/${username}.svg`;
</script>

<img {src} alt={`${username}'s avatar`} title={username} class="user-avatar" {...$$restProps} on:click on:error on:load />

<style>
  .user-avatar {
    border-radius: 50%;
    border: var(--avatar-border);
    width: var(--avatar-size, 4rem);
    height: var(--avatar-size, 4rem);
  }
</style>
