<script lang="ts">
  import type { UserFront } from "@bgs/models";
  import { UserGames, UserElo, SEO, UserAvatar } from "@/components";
  import { Button, Card } from "@/modules/cdk";
  import { account } from "@/lib/account.svelte";
  import { dateFromObjectId } from "@/utils";
  import { page } from "$app/stores";

  let { data }: { data: { user: UserFront } } = $props();
  let username = $derived(data.user.account.username);
  let joinDate = $derived(data.user && dateFromObjectId(data.user._id));
</script>

<SEO
  title={`${username}'s profile`}
  description={data.user.account.bio ||
    `${username} joined in ${dateFromObjectId(data.user._id).toLocaleString("en", {
      month: "long",
    })} ${dateFromObjectId(data.user._id).toLocaleString("en", { year: "numeric" })} and has ${data.user.account.karma} karma.`}
  image={`${$page.url.origin}/api/user/${data.user._id}/avatar`}
/>

<div class="container mx-auto px-4">
  <div class="flex flex-col gap-2 md:flex-row">
    <div class="md:mr-2 md:w-64 md:min-w-64">
      <UserAvatar
        username={data.user.account.username}
        --avatar-border="1px solid gray"
        userId={data.user._id}
        size="8rem"
      />
      <h1>{username}</h1>
      <div>
        ☯️ <a href="/page/karma" title="karma">{data.user.account.karma}</a> karma <br />
        🎉 Joined us in {joinDate.toLocaleString("en", { month: "long" })}
        {joinDate.toLocaleString("default", { year: "numeric" })}!
      </div>
      {#if data.user.account.bio}<p class="mt-2" title={`${data.user.account.username}'s bio`}>
          📝 {data.user.account.bio}
        </p>{/if}
      {#if data.user && $account?._id === data.user._id}
        <Button color="primary" href="/account">Settings</Button>
      {/if}
    </div>
    <div class="grow-[3]">
      <UserGames userId={data.user._id} />

      <Card class="border-gray-300 mt-4 dark:border-gray-600" header="Statistics">
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div class="mb-3">
            <UserElo userId={data.user._id} />
          </div>
          <div>
            <h3 class="text-lg font-semibold">Tournaments</h3>
            <p>No Tournament info available</p>
          </div>
        </div>
      </Card>
    </div>
  </div>
</div>
