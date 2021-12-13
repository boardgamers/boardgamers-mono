<script lang="ts">
  import { handleError, oneLineMarked, duration } from "@/utils";
  import marked from "marked";
  import { fromPairs, upperFirst } from "lodash";
  import { Button, Col, Input, Checkbox, Row, Loading, Container } from "@/modules/cdk";
  import { navigate } from "@/modules/router";
  import { adjectives, nouns } from "@/data";
  import type { PlayerOrder } from "@bgs/types";
  import { playerOrders } from "@/data/playerOrders";
  import { useAccount } from "@/composition/useAccount";
  import { useLoggedIn } from "@/composition/useLoggedIn";
  import { useRest } from "@/composition/useRest";
  import { useGameInfo } from "@/composition/useGameInfo";
  import { page } from "$app/stores";

  useLoggedIn();

  const { account } = useAccount();
  const { post } = useRest();
  const { gameInfo } = useGameInfo();

  $: boardgameId = $page.params.boardgameId;
  $: info = gameInfo(boardgameId, "latest");

  let gameId = randomId();
  let seed = "";
  let numPlayers = 2;

  let options = ["join"];
  let playerOrder: PlayerOrder = "random";
  let selects: Record<string, string> = {};
  let expansions: string[] = [];

  let timePerMove = 2 * 3600;
  let timePerGame = 3 * 24 * 3600;
  let submitting = false;
  let timerEnd = "22:00";
  let timerStart = "09:00";

  let scheduledDay = null as string | null;
  let scheduledTime = "";

  let enableKarma = false;
  let minimumKarma = Math.min(75, $account!.account.karma - 5);

  function createGame() {
    submitting = true;

    const dataObj = {
      game: {
        game: boardgameId,
        version: info._id.version,
      },
      gameId,
      players: numPlayers,
      timePerMove,
      timePerGame,
      options: { ...fromPairs(options.map((key) => [key, true])), ...selects, playerOrder },
      seed,
      expansions,
      timerStart: undefined as number | undefined,
      timerEnd: undefined as number | undefined,
      scheduledStart: undefined as number | undefined,
      minimumKarma: +minimumKarma as number | undefined,
    };

    if (scheduledDay && scheduledTime) {
      dataObj.scheduledStart = Date.parse(`${scheduledDay}T${scheduledTime}`);
    } else {
      delete dataObj.scheduledStart;
    }

    if (!enableKarma || !dataObj.minimumKarma) {
      delete dataObj.minimumKarma;
    }

    if (timerStart === undefined || timerStart === timerEnd || timerEnd === undefined) {
      delete dataObj.timerStart;
      delete dataObj.timerEnd;
    } else {
      const toTime = (x: string) => {
        const hours = +x.slice(0, 2);
        const minutes = +x.slice(3, 5);

        return (hours * 3600 + minutes * 60 + new Date().getTimezoneOffset() * 60 + 24 * 3600) % (24 * 3600);
      };

      dataObj.timerStart = toTime(timerStart);
      dataObj.timerEnd = toTime(timerEnd);
    }

    post("/game/new-game", dataObj)
      .then(() => navigate("/game/" + gameId), handleError)
      .finally(() => (submitting = false));
  }

  $: gameId = gameId.trim().replace(/ /g, "-");

  const updateSelects = async () => {
    // Load default values for multiple choice options
    const newVal: Record<string, string> = {};

    for (const select of info.options.filter((option) => option.type === "select")) {
      if (select.items) {
        newVal[select.name] =
          select.default && select.items.some((item) => item.name === select.default)
            ? select.default
            : select.items[0].name;
      }
    }

    for (const check of info.options.filter((option) => option.type === "checkbox")) {
      if (check.default === true) {
        options.push(check.name);
      }
    }

    if (!info.players.includes(numPlayers)) {
      numPlayers = info.players[0];
    }

    selects = newVal;
  };

  $: updateSelects(), [boardgameId];

  function randomId() {
    return (
      upperFirst(adjectives[Math.floor(Math.random() * adjectives.length)]) +
      "-" +
      nouns[Math.floor(Math.random() * nouns.length)] +
      "-" +
      Math.ceil(Math.random() * 9999)
    );
  }
</script>

<Container>
  <Loading loading={!info}>
    <h1 class="mb-4">{info.label}</h1>
    <form on:submit|preventDefault={createGame}>
      <div class="row">
        <div class="col-md-6">
          <h2>Description</h2>
          {@html marked(info.description)}
        </div>

        <div class="col-md-6">
          <h2>Rules</h2>
          {@html marked(info.rules)}
        </div>
      </div>

      <h2>Settings</h2>
      <div class="row">
        <div class="form-group col-md-4">
          <label for="players">Number of players</label>
          <Input type="select" bind:value={numPlayers}>
            {#each info.players as option}
              <option value={option}>{option} players</option>
            {/each}
          </Input>
        </div>

        <div class="form-group col-md-4">
          <label for="gameId">Game Id</label>
          <input
            class="form-control"
            id="gameId"
            type="text"
            maxlength="25"
            name="gameId"
            bind:value={gameId}
            placeholder="Game ID"
            aria-label="Game ID"
            required
          />
          <small class="form-text text-muted">Use only alphanumeric characters and hyphens.</small>
        </div>

        <div class="form-group col-md-4">
          <label for="seed">Custom Seed</label>
          <input
            class="form-control"
            id="seed"
            type="text"
            maxlength="25"
            name="gameId"
            bind:value={seed}
            placeholder="Random seed"
            aria-label="Random seed"
          />
          <small class="form-text text-muted">Games sharing the same seed will have configuration.</small>
        </div>
      </div>

      <Row class="mb-3">
        <Col sm="3" class="d-flex align-items-center">
          <Checkbox bind:checked={enableKarma}>Karma restriction</Checkbox>
        </Col>
        <Col sm="9">
          <Input
            type="number"
            disabled={!enableKarma}
            placeholder="Minimum karma to join the game"
            bind:value={minimumKarma}
            max={$account.account.karma - 5}
          />
        </Col>
      </Row>

      {#if info.expansions.length > 0}
        <div class="mb-3">
          <h3>Expansions</h3>
          {#each info.expansions as expansion}
            <Checkbox bind:group={expansions} value={expansion.name}>
              {expansion.label}
            </Checkbox>
          {/each}
        </div>
      {/if}

      <h3>Timing</h3>

      <Row>
        <div class="form-group col-md-6">
          <label for="timePerGame">Time per player per game</label>
          <select bind:value={timePerGame} id="timePerGame" class="form-control">
            {#each [300, 600, 1800, 3600, 6 * 3600, 24 * 3600, 3 * 24 * 3600, 10 * 24 * 3600] as x}
              <option value={x}>
                {duration(x)}
              </option>
            {/each}
          </select>
        </div>

        <div class="form-group col-md-6">
          <label for="timePerMove">Additional time per move</label>
          <select bind:value={timePerMove} id="timePerMove" class="form-control">
            {#each [30, 60, 5 * 60, 15 * 60, 3600, 2 * 3600, 6 * 3600, 24 * 3600] as x}
              <option value={x}>
                {duration(x)}
              </option>
            {/each}
          </select>
        </div>

        <div class="form-group col-md-6">
          <label for="scheduledDate">Scheduled start (day)</label>
          <input type="date" class="form-control" bind:value={scheduledDay} placeholder="Scheduled day" />
          <small class="form-text text-muted">Game will start that day or be cancelled.</small>
        </div>

        <div class="form-group col-md-6">
          <label for="scheduledTime">Scheduled start (time)</label>
          <input type="time" class="form-control" bind:value={scheduledTime} placeholder="Scheduled time" />
          <small class="form-text text-muted">Game will start at that time or be cancelled.</small>
        </div>

        <div class="form-group col-md-6">
          <label for="timerStart">Timer begins at</label>
          <input type="time" class="form-control" bind:value={timerStart} placeholder="Timer start" />
          <small class="form-text text-muted">Timer will start / resume at this time of the day.</small>
        </div>

        <div class="form-group col-md-6">
          <label for="timerEnd">Timer stops at</label>
          <input type="time" class="form-control" bind:value={timerEnd} placeholder="Timer pause" />
          <small class="form-text text-muted">Timer will pause at this time of the day.</small>
        </div>
      </Row>

      <h3>Other options</h3>

      <Checkbox bind:group={options} value="unlisted">Unlisted</Checkbox>
      <Checkbox bind:group={options} value="join">Join this game</Checkbox>
      {#each info.options.filter((opt) => opt.type === "checkbox") as option}
        <Checkbox bind:group={options} value={option.name}>{@html oneLineMarked(option.label)}</Checkbox>
      {/each}

      <div class="form-group mt-2">
        <label for="playerOrder">Player order</label>
        <Input type="select" bind:value={playerOrder} id="playerOrder" required>
          {#each playerOrders as item}
            <option value={item.name}>{item.label}</option>
          {/each}
        </Input>
      </div>

      {#each info.options.filter((opt) => opt.type === "select") as select}
        <div class="form-group mt-2">
          <label for={select.name}>{@html oneLineMarked(select.label)}</label>
          <Input type="select" bind:value={selects[select.name]} id={select.name} required>
            {#each select.items || [] as item}
              <option value={item.name}>{marked(item.label).replace(/<[^>]+>/g, "")}</option>
            {/each}
          </Input>
        </div>
      {/each}

      <Button class="mt-3 float-right" type="submit" color="primary" disabled={submitting}>New game</Button>
    </form>
  </Loading>
</Container>
