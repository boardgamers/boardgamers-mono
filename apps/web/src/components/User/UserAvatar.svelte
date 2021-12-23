<script lang="ts">
  export let username: string;
  export let size = "4em";
</script>

<img
  src={`https://avatars.dicebear.com/api/personas/${username}.svg`}
  alt={`${username}'s avatar`}
  class="user-avatar"
/>

<style>
  .user-avatar {
    border-radius: 50%;
    border: 1px solid gray;
    width: var(--avatar-size, "4rem");
    height: var(--avatar-size, "4rem");
  }
</style>
