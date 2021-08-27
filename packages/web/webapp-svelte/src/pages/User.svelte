<script lang="ts">
  import { handleError } from "@/utils";
  import type { IUser } from "@shared/types/user";
  import { UserGames, UserPublicInfo, UserElo} from "@/components";
  import { get } from "@/api";
  import { Row, Col, Container, Card, Loading } from "@/modules/cdk";
  import { user as ownUser } from "@/store"

  export let username: string;
  let user: IUser;

  const onUserNameChanged = () => get(`/user/infoByName/${encodeURIComponent(username)}`).then(r => user = r).catch(handleError)  
  $: onUserNameChanged(), [username]
</script>

<svelte:head>
  <title>{username} - Boardgamers 🌌</title>
</svelte:head>

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

    <Card class="border-info mt-4" header="Statistics">
      <Row>
        <Col lg={6} class="mb-3">
          <UserElo userId={user._id} />
        </Col>
        <Col>
          <h3 class="card-title">Tournaments</h3>
          <p>No Tournament info available</p>
        </Col>
      </Row>
    </Card>
  </Loading>
</Container>
