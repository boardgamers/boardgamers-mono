///<reference types="svelte" />
;
import { page } from "$app/stores";
import { loadGameInfos, gameInfos, latestGameInfos } from "@/lib/game-info.svelte";
import { logoClick } from "@/lib/stores.svelte";
import { ListGroup } from "@/modules/cdk";
import { handleError } from "@/utils";
import type { GameInfo } from "@bgs/models";
function $$render() {
/*Ωignore_startΩ*/;let $page = __sveltets_2_store_get(page);;let $gameInfos = __sveltets_2_store_get(gameInfos);/*Ωignore_endΩ*/
  
  
  
  
  
  

  loadGameInfos().catch(handleError);

  let games: GameInfo[];
  ;() => {$: ((games = latestGameInfos() as GameInfo[]), [$gameInfos]);}
  let  boardgameId = __sveltets_2_invalidate(() => $page!.params.boardgameId);

  function gameRoute(gameId: string) {
    if (!boardgameId) {
      return `/boardgame/${gameId}${$page.url.pathname}`;
    }

    if (gameId === boardgameId) {
      if ($page.url.pathname === "/boardgame/" + gameId) {
        return "/refresh-games";
      } else {
        return "/boardgame/" + gameId;
      }
    }

    return $page.url.pathname.replace(`/boardgame/${boardgameId}`, `/boardgame/${gameId}`) + $page.url.search;
  }

  function handleClick(event: MouseEvent & { currentTarget: HTMLAnchorElement }) {
    if (event.currentTarget.attributes.getNamedItem("href")!.value === "/refresh-games") {
      event.preventDefault();
      logoClick();
    }
  }
;
async () => {

 { const $$_puorGtsiL0C = __sveltets_2_ensureComponent(ListGroup); new $$_puorGtsiL0C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"flush":true,"class":`d-none d-lg-block ms-n3`,"style":`width: 250px`,}});
  boardgameId; {
      for(let game of __sveltets_2_ensureArray(games)){
       { svelteHTML.createElement("a", {            "class":`list-group-item-action list-group-item`,"href":gameRoute(game._id.game),"data-sveltekit-preload-data":`hover`,"on:click":handleClick,"style":`font-weight: 600`,});boardgameId === game._id.game;
        game.label;
       }
    }
  }
 ListGroup}
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const GameListSidebar__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type GameListSidebar__SvelteComponent_ = InstanceType<typeof GameListSidebar__SvelteComponent_>;
/*Ωignore_endΩ*/export default GameListSidebar__SvelteComponent_;