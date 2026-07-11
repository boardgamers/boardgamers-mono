<script lang="ts">
  import type { IUser } from "@bgs/models";
  import { UserGames, UserElo, SEO, UserAvatar } from "@/components";
  import { Row, Col, Container, Card } from "@/modules/cdk";
  import { account } from "@/lib/account.svelte";
  import { dateFromObjectId } from "@/utils";
  import { page } from "$app/stores";

  let { data }: { data: { user: IUser } } = $props();
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

<Container>
  <div class="user-layout">
    <div class="user-info">
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
        <a class="btn btn-primary" href="/account" role="button">Settings</a>
      {/if}
    </div>
    <div style="flex-grow: 3">
      <UserGames userId={data.user._id} />

      <Card class="border-secondary mt-4" header="Statistics">
        <Row>
          <Col lg={6} class="mb-3">
            <UserElo userId={data.user._id} />
          </Col>
          <Col>
            <h3 class="card-title">Tournaments</h3>
            <p>No Tournament info available</p>
          </Col>
        </Row>
      </Card>
    </div>
  </div>
</Container>

<style lang="postcss">
  @media (min-width: 768px) {
    .user-info {
      width: 256px;
      min-width: 256px;
      margin-right: 0.5rem;
    }
  }
  .user-layout {
    display: flex;

    @media (max-width: 767.98px) {
      flex-direction: column;
    }
  }
</style>
