///<reference types="svelte" />
;
import { browser } from "$app/environment";
import { keyBy } from "lodash";
import { elapsedSeconds } from "@bgs/utils";
import { timerTime, oneLineMarked, handleError, confirm, duration, shortDuration } from "@/utils";
import type { PlayerInfoFront } from "@bgs/models";
import Portal from "@/modules/portal";
import clockHistory from "@iconify/icons-bi/clock-history.js";
import { Button, Icon, Badge } from "@/modules/cdk";
import { getContext, onDestroy } from "svelte";
import { GameLog, ReplayControls, GameNotes, GamePreferences, GameSettings } from "./GameSidebar";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import PlayerGameAvatar from "./PlayerGameAvatar.svelte";
import { post } from "@/lib/api";
import { account } from "@/lib/account.svelte";
import { playerStatus, addActiveGame, removeActiveGame, devGameSettings } from "@/lib/stores.svelte";
function $$render() {
/*Ωignore_startΩ*/;let $account = __sveltets_2_store_get(account);;let $playerStatus = __sveltets_2_store_get(playerStatus);;let $devGameSettings = __sveltets_2_store_get(devGameSettings);/*Ωignore_endΩ*/
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  const { game, players, gameInfo }: GameContext = getContext("game")/*Ωignore_startΩ*/;let $game = __sveltets_2_store_get(game);;let $players = __sveltets_2_store_get(players);;let $gameInfo = __sveltets_2_store_get(gameInfo);/*Ωignore_endΩ*/;

  let secondsCounter = 0;

  const interval = setInterval(() => {
    if (browser && !document.hidden) {
      secondsCounter += 1;
    }
  }, 1000);
  onDestroy(() => clearInterval(interval));

  let requestedDrop: Record<string, boolean> = {};

  let  userId = __sveltets_2_invalidate(() => $account?._id);
  let  playerUser = __sveltets_2_invalidate(() => $game?.players.find((pl) => pl._id === userId));
  let  gameId = __sveltets_2_invalidate(() => $game?._id);

  function status(playerId: string) {
    return $playerStatus?.find((pl) => pl._id === playerId)?.status ?? "offline";
  }

  function playerElo(playerId: string) {
    return $players.find((pl) => pl._id === playerId)?.elo ?? 0;
  }

  let  alwaysActive = __sveltets_2_invalidate(() => $game?.options.timing.timer?.start === $game?.options.timing.timer?.end);

  let  currentPlayersById = __sveltets_2_invalidate(() => keyBy($game?.currentPlayers ?? [], "_id"));

  function isCurrentPlayer(id: string) {
    return $game?.status !== "ended" && !!currentPlayersById[id];
  }

  const onGameChanged = () => {
    if (userId) {
      if (isCurrentPlayer(userId)) {
        addActiveGame(gameId);
      } else {
        removeActiveGame(gameId);
      }
    }
  };

  ;() => {$: (onGameChanged(), [userId, $game]);}

  let remainingTimes: Record<string, number> = {};

  function updateRemainingTimes() {
    const ret: Record<string, number> = {};
    for (const player of $game.players) {
      ret[player._id] = remainingTime(player);
    }

    remainingTimes = ret;
  }

  ;() => {$: (updateRemainingTimes(), [secondsCounter]);}

  function remainingTime(player: PlayerInfoFront) {
    const currentPlayer = currentPlayersById[player._id];
    if (currentPlayer) {
      const spent = elapsedSeconds(new Date(currentPlayer.timerStart as any), $game.options.timing.timer);
      // Trick to update every second
      return Math.max(player.remainingTime - spent, 0) + (secondsCounter % 1);
    }
    return Math.max(player.remainingTime, 0);
  }

  async function voteCancel() {
    if (
      await confirm("This vote cannot be taken back. If all active players vote to cancel, the game will be cancelled.")
    ) {
      await post(`/game/${gameId}/cancel`).catch(handleError);
    }
  }

  async function quit() {
    await post(`/game/${gameId}/quit`).catch(handleError);
  }

  async function requestDrop(playerId: string) {
    await post(`/game/${gameId}/drop/${playerId}`).then(
      () => (requestedDrop = { ...requestedDrop, [playerId]: true }),
      handleError
    );
  }
;
async () => {

 { svelteHTML.createElement("div", {  "id":`floating-controls`,});}
 { const $$_latroP0C = __sveltets_2_ensureComponent(Portal); new $$_latroP0C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"target":`#sidebar`,}});
   { svelteHTML.createElement("h3", { "class":`mt-75`,});  }
    for(let player of __sveltets_2_ensureArray($game.players)){
     { svelteHTML.createElement("div", {  "class":"mb-1 d-flex align-items-center player-row",});isCurrentPlayer(player._id);
       { const $$_ratavAemaGreyalP2C = __sveltets_2_ensureComponent(PlayerGameAvatar); new $$_ratavAemaGreyalP2C({ target: __sveltets_2_any(), props: {        "game":$game.game.name,userId,player,"status":status(player._id),"class":`me-2`,}});}

       { svelteHTML.createElement("div", {});
         { svelteHTML.createElement("a", {    "href":`/user/${player.name}`,"class":`player-name`,});player.dropped;
          player.name;
         }
         { svelteHTML.createElement("sup", { "class":`ms-1`,});
          if(player.elo){
            player.elo.initial; player.elo.delta >= 0 ? "+" : "-"; Math.abs(player.elo.delta); }else{
            playerElo(player._id); }
         }
        if($game.status === "active"){
           { svelteHTML.createElement("span", { "class":`ms-1`,});  shortDuration(remainingTimes[player._id]); }
        }
       }
     }
  }
   { svelteHTML.createElement("div", { "class":`mt-75`,});
     { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {      "icon":clockHistory,"inline":true,"class":`me-1`,}});}
    alwaysActive
      ? "24h"
      : `${timerTime($game.options.timing.timer.start)}-${timerTime($game.options.timing.timer.end)}`;
     duration($game.options.timing.timePerGame);  duration($game.options.timing.timePerMove);
   }
  if($game.status === "ended"){
     { svelteHTML.createElement("div", { "class":`mt-75`,});
       { svelteHTML.createElement("b", {});    }
     }
  }
  $game.currentPlayers; {
    if(userId && isCurrentPlayer(userId)){
       { svelteHTML.createElement("div", { "class":`mt-75`,});
         { svelteHTML.createElement("b", { "class":`your-turn`,});  }
       }
    }
  }
  if(playerUser && $game.status !== "ended"){
     { svelteHTML.createElement("div", { "class":`mt-75`,});
       { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {         children:() => { return __sveltets_2_any(0); },"color":`warning`,"size":`sm`,"disabled":playerUser.dropped || playerUser.voteCancel || playerUser.quit,}});$$_nottuB2.$on("click", voteCancel);
          
       Button}
      if($game.players.some((pl) => !!pl.dropped)){
         { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {       children:() => { return __sveltets_2_any(0); },"size":`sm`,"class":`ms-2`,"disabled":playerUser.dropped || playerUser.quit,}});$$_nottuB2.$on("click", quit);  Button}
      }
        for(let player of __sveltets_2_ensureArray($game.players)){
        if(remainingTime(player) <= 0 && isCurrentPlayer(player._id) && !player.dropped && !player.quit){
           { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {           children:() => { return __sveltets_2_any(0); },"size":`sm`,"class":`ms-2`,"color":`danger`,"disabled":requestedDrop[player._id],}});$$_nottuB2.$on("click", () => requestDrop(player._id));
             player.name;
           Button}
        }
      }
     }
  }

   { const $$_sgnitteSemaG1C = __sveltets_2_ensureComponent(GameSettings); new $$_sgnitteSemaG1C({ target: __sveltets_2_any(), props: {}});}

   { const $$_secnereferPemaG1C = __sveltets_2_ensureComponent(GamePreferences); new $$_secnereferPemaG1C({ target: __sveltets_2_any(), props: {}});}

   { const $$_setoNemaG1C = __sveltets_2_ensureComponent(GameNotes); new $$_setoNemaG1C({ target: __sveltets_2_any(), props: { gameId,}});}

  if($game.game.expansions?.length > 0){
     { svelteHTML.createElement("div", { "class":`mt-75`,});
       { svelteHTML.createElement("h3", {});  }
        for(let expansion of __sveltets_2_ensureArray($game.game.expansions)){
         { const $$_egdaB2C = __sveltets_2_ensureComponent(Badge); new $$_egdaB2C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"color":`accent`,"class":`me-1`,}});
           oneLineMarked($gameInfo.expansions.find((xp) => xp.name === expansion)?.label ?? "");
         Badge}
      }
     }
  }

   { const $$_goLemaG1C = __sveltets_2_ensureComponent(GameLog); new $$_goLemaG1C({ target: __sveltets_2_any(), props: {}});}

   { const $$_slortnoCyalpeR1C = __sveltets_2_ensureComponent(ReplayControls); new $$_slortnoCyalpeR1C({ target: __sveltets_2_any(), props: {}});}

  if($gameInfo.options.some((x) => !!$game.game.options?.[x.name])){
     { svelteHTML.createElement("div", { "class":`mt-75`,});
       { svelteHTML.createElement("h3", {});  }
        for(let pref of __sveltets_2_ensureArray($gameInfo.options.filter((x) => !!$game.game.options[x.name]))){
         { const $$_egdaB2C = __sveltets_2_ensureComponent(Badge); new $$_egdaB2C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"color":`secondary`,"class":`me-1`,}});
          if(pref.type === "checkbox"){
             oneLineMarked(pref.label);
          } else if (pref.type === "select" && pref.items && pref.items.some((x) => x.name === $game.game.options[pref.name])){
             oneLineMarked(
              pref.label + ": " + pref.items.find((x) => x.name === $game.game.options[pref.name])?.label
            );
          }
         Badge}
      }
     }
  }
   { svelteHTML.createElement("div", {  "class":`my-3`,});}
  if($devGameSettings){
     { svelteHTML.createElement("a", {     "target":`_blank`,"rel":`external`,"href":`/api/gameplay/${$game._id}`,});  }
  }
 Portal}


};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const GameSidebar__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type GameSidebar__SvelteComponent_ = InstanceType<typeof GameSidebar__SvelteComponent_>;
/*Ωignore_endΩ*/export default GameSidebar__SvelteComponent_;