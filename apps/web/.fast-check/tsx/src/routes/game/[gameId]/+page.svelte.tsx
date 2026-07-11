///<reference types="svelte" />
;
import { GameSidebar, OpenGame, StartedGame, ChatRoom } from "@/components";
import type { IGame, PlayerInfoFront, GameInfo } from "@bgs/models";
import { onDestroy, setContext } from "svelte";
import { writable } from "svelte/store";
import EventEmitter from "eventemitter3";
import { currentGameId, room as currentRoom } from "@/lib/stores.svelte";
function $$render() {

  
  
  
  
  
  /*Ωignore_startΩ*/;type $$ComponentProps = { data: import('./$types.js').PageData };/*Ωignore_endΩ*/

  let { data }: $$ComponentProps = $props();
  let game: IGame = $derived(data.game);
  let players: PlayerInfoFront[] = $derived(data.players);
  let gameInfo: GameInfo = $derived(data.gameInfo);

  let gameId = $derived(game._id);
  $effect(() => {
    currentGameId.set(gameId);
    currentRoom.set(gameId);
  });

  const context = {
    game: writable<IGame | null>(null),
    players: writable<PlayerInfoFront[]>([]),
    gameInfo: writable<GameInfo | null>(null),
    replayData: writable<{ start: number; end: number; current: number } | null>(null),
    emitter: new EventEmitter(),
    log: writable<string[]>([]),
  };

  setContext("game", context);

  $effect(() => {
    context.game.set(game);
    context.players.set(players);
    context.gameInfo.set(gameInfo);
  });

  onDestroy(() => {
    currentGameId.set(null);
    currentRoom.set(null);
  });
;
async () => {

if(game.status === "open"){
   { const $$_emaGnepO0C = __sveltets_2_ensureComponent(OpenGame); new $$_emaGnepO0C({ target: __sveltets_2_any(), props: {}});}
}else{
   { const $$_emaGdetratS0C = __sveltets_2_ensureComponent(StartedGame); new $$_emaGdetratS0C({ target: __sveltets_2_any(), props: {}});}
}
 { const $$_mooRtahC0C = __sveltets_2_ensureComponent(ChatRoom); new $$_mooRtahC0C({ target: __sveltets_2_any(), props: {  "room":gameId,}});}
 { const $$_rabediSemaG0C = __sveltets_2_ensureComponent(GameSidebar); new $$_rabediSemaG0C({ target: __sveltets_2_any(), props: {}});}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Page__SvelteComponent_ = ReturnType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;