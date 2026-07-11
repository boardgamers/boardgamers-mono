///<reference types="svelte" />
;
import type { PlayerInfoFront } from "@bgs/models";
import { classnames, handleError } from "@/utils";
import { account } from "@/lib/stores.svelte";
import { loadGameInfo, gameInfo, gameInfos } from "@/lib/game-info.svelte";
import { browser } from "$app/environment";
function $$render() {
/*Ωignore_startΩ*/;let $account = __sveltets_2_store_get(account);;let $gameInfos = __sveltets_2_store_get(gameInfos);/*Ωignore_endΩ*/
  
  
  
  
  

   let player: PlayerInfoFront/*Ωignore_startΩ*/;player = __sveltets_2_any(player);/*Ωignore_endΩ*/;
   let showVp = true/*Ωignore_startΩ*/;showVp = __sveltets_2_any(showVp);/*Ωignore_endΩ*/;
   let game: string/*Ωignore_startΩ*/;game = __sveltets_2_any(game);/*Ωignore_endΩ*/;

   let status = "";
  let className = "";
  

   let userId: string | undefined/*Ωignore_startΩ*/;userId = __sveltets_2_any(userId);/*Ωignore_endΩ*/;
   let isCurrent: boolean | undefined/*Ωignore_startΩ*/;isCurrent = __sveltets_2_any(isCurrent);/*Ωignore_endΩ*/;

  ;() => {$: browser && game && !gameInfo(game) && loadGameInfo(game).catch(handleError);}

  let style: string;

  let  highlightedPlayerId = __sveltets_2_invalidate(() => userId ?? $account?._id);
  ;() => {$: ((style = `background-image: url('${
    player.faction && gameInfo(game)?.factions?.avatars
      ? `/images/factions/icons/${player.faction}.svg`
      : `/api/user/${player._id}/avatar?d=${$account?.account.avatar}`
  }')`),
    [$gameInfos]);}
;
async () => {

  { svelteHTML.createElement("div", {       style,"title":player.name,"class":classnames("player-avatar", className),});highlightedPlayerId && player._id === highlightedPlayerId;isCurrent;
  if(showVp){
     { svelteHTML.createElement("span", { "class":`vp ${status}`,});player.score; }
  }
 }


};
return { props: {player: player , showVp: showVp , game: game , status: status , class: className , userId: userId , isCurrent: isCurrent} as {player: PlayerInfoFront, showVp?: typeof showVp, game: string, status?: typeof status, class?: typeof className, userId: string | undefined, isCurrent: boolean | undefined}, exports: {}, bindings: "", slots: {}, events: {} }}
const PlayerGameAvatar__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type PlayerGameAvatar__SvelteComponent_ = InstanceType<typeof PlayerGameAvatar__SvelteComponent_>;
/*Ωignore_endΩ*/export default PlayerGameAvatar__SvelteComponent_;