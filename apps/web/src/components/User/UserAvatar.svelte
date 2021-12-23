<script lang="ts">
  export let userId: string;
  export let username: string;
</script>

<img src={`/api/user/${userId}/avatar`} alt={`${username}'s avatar`} class="user-avatar" />

<style>
  .user-avatar {
    border-radius: 50%;
    border: var(--avatar-border, "1px solid gray");
    width: var(--avatar-size, "4rem");
    height: var(--avatar-size, "4rem");
  }
</style>
