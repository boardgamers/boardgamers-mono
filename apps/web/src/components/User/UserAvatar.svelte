<script lang="ts">
  import { useAccount } from "@/composition/useAccount";

  const { account } = useAccount();

  export let userId: string | null = null;
  export let username: string;
  export let art = "pixel-art";

  let src: string;

  $: src = userId
    ? `/api/user/${userId}/avatar?d=${$account?.account.avatar}`
    : `https://avatars.dicebear.com/api/${art}/${username}.svg`;
</script>

<img {src} alt={`${username}'s avatar`} class="user-avatar" />

<style>
  .user-avatar {
    border-radius: 50%;
    border: var(--avatar-border);
    width: var(--avatar-size, 4rem);
    height: var(--avatar-size, 4rem);
  }
</style>
