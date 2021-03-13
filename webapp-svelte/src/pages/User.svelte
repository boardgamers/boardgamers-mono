<script lang="ts">
  import { defer } from "@/utils";
  import type { IUser } from "@lib/user";
  import UserGames from "@/components/UserGames.svelte";
  import UserPublicInfo from "@/components/UserPublicInfo.svelte";
  import { get } from "@/api";
  import Loading from "@/components/Loading.svelte";
  import { Row, Col, Container } from "sveltestrap";
  import { user as ownUser } from "@/store"
  // import UserElo from "../components/UserElo.vue";

  export let username: string;
  let user: IUser;
  
  defer(() => get(`/user/infoByName/${encodeURIComponent(username)}`).then(r => user = r))()
</script>

<Container>
  <Row>
    <Col>
      <h1>{username}</h1>
    </Col>
    <Col class="text-right">
      {#if user && $ownUser?._id === user._id}
        <a class="btn btn-primary" href="/account" role="button">Settings</a>
      {/if}
    </Col>
  </Row>
  <Loading loading={!user}>
    <UserPublicInfo class="mt-4" {user} />
    <UserGames userId={user._id} />
  </Loading>
</Container>
