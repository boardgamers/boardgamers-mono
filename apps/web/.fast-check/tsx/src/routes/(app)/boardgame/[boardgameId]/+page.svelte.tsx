///<reference types="svelte" />
;
import { confirm, handleError } from "@/utils";
import marked from "marked";
import type { GameInfo } from "@bgs/models";
import { Card, Row, Col } from "@/modules/cdk";
import { UserGameSettings, GameList, BoardgameElo, SEO } from "@/components";
import { account } from "@/lib/account.svelte";
import { gameInfo, loadGameInfo, gameInfos } from "@/lib/game-info.svelte";
import { gamePreferences, loadGamePreferences } from "@/lib/game-preferences.svelte";
import { page } from "$app/stores";
import { goto } from "$app/navigation";
import type { LoadEloRankingsResult } from "@/lib/elo-rankings.svelte";
import { gameLabel } from "@/utils/game-label";

;type $$ComponentProps =  { data: { rankings: LoadEloRankingsResult } };function $$render() {
/*Ωignore_startΩ*/;let $account = __sveltets_2_store_get(account);;let $gameInfos = __sveltets_2_store_get(gameInfos);;let $gamePreferences = __sveltets_2_store_get(gamePreferences);;let $page = __sveltets_2_store_get(page);/*Ωignore_endΩ*/
  
  
  
  
  
  
  
  
  
  
  
  

  let { data }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let boardgameId = $derived($page.params.boardgameId);
  let boardgame = $derived.by(() => {
    // track the gameInfos store so this re-evaluates after loadGameInfo resolves
    $gameInfos;
    return gameInfo(boardgameId, "latest") as GameInfo;
  });
  let hasOwnership = $derived($gamePreferences[boardgameId]?.access?.ownership);
  let needOwnership = $derived(boardgame?.meta?.needOwnership);

  let rules = $state(false);

  const onUserChanged = () => {
    loadGameInfo(boardgameId, "latest").catch(handleError);
    loadGamePreferences(boardgameId).catch(handleError);
  };

  // re-run whenever the logged-in account or boardgame changes
  $effect(() => {
    $account?._id;
    boardgameId;
    onUserChanged();
  });

  async function newGame() {
    if (needOwnership && !hasOwnership) {
      await confirm(
        "You need to have game ownership to host a new game. You can set game ownership in your account settings."
      );
    } else {
      goto(`/new-game/${boardgameId}`);
    }
  }
;
async () => {

 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {     "title":`${gameLabel(boardgame.label)} - Boardgames`,"description":`Play ${gameLabel(boardgame.label)} online with other people!`,}});}

 { svelteHTML.createElement("div", { "class":`home container`,});
   { svelteHTML.createElement("h1", {});boardgame.label; }

   { svelteHTML.createElement("div", { "class":`row row-cols-1 row-cols-md-2 g-4`,});
     { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
       { const $$_draC3C = __sveltets_2_ensureComponent(Card); const $$_draC3 = new $$_draC3C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"class":`border-secondary h-100`,"header":rules ? "Rules" : "Description",}});
         marked(rules ? boardgame.rules : boardgame.description);
         {const {/*Ωignore_startΩ*/$$_$$/*Ωignore_endΩ*/,} = $$_draC3.$$slot_def["footer"];$$_$$;{ svelteHTML.createElement("a", {     "href":rules ? "#description" : "#rules","on:click":() => (rules = !rules),});
          rules ? "See description" : "See rules";
         }}
       Card}
     Col}
     { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
       { const $$_sgnitteSemaGresU3C = __sveltets_2_ensureComponent(UserGameSettings); new $$_sgnitteSemaGresU3C({ target: __sveltets_2_any(), props: {      "title":`Settings`,"game":boardgame,"class":`h-100`,}});}
     Col}
   }

   { const $$_woR1C = __sveltets_2_ensureComponent(Row); new $$_woR1C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
     { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"lg":6,"class":`mt-3`,}});
       { const $$_tsiLemaG3C = __sveltets_2_ensureComponent(GameList); new $$_tsiLemaG3C({ target: __sveltets_2_any(), props: {           boardgameId,"gameStatus":`active`,"userId":$account?._id,"perPage":5,"topRecords":true,"title":$account?._id ? "My games" : "Featured games",}});}
     Col}
     { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"lg":6,"class":`mt-3`,}});
       { const $$_tsiLemaG3C = __sveltets_2_ensureComponent(GameList); new $$_tsiLemaG3C({ target: __sveltets_2_any(), props: {       "sample":true,"perPage":5,boardgameId,"gameStatus":`open`,"title":`Lobby`,}});}
     Col}
   Row}

   { svelteHTML.createElement("div", { "class":`text-center mt-3`,});
     { svelteHTML.createElement("a", {     "class":`btn btn-accent`,"href":`/boardgame/${boardgameId}/games`,"role":`button`,});  }
     { svelteHTML.createElement("button", {     "class":`btn btn-primary mx-3`,"href":`/new-game`,"on:click":newGame,});  }
     { svelteHTML.createElement("a", {     "class":`btn btn-accent`,"href":`/boardgame/${boardgameId}/rankings`,"role":`button`,});  }
   }

   { const $$_woR1C = __sveltets_2_ensureComponent(Row); new $$_woR1C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
     { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"lg":6,"class":`mt-3`,}});
       { const $$_tsiLemaG3C = __sveltets_2_ensureComponent(GameList); new $$_tsiLemaG3C({ target: __sveltets_2_any(), props: {       "gameStatus":`active`,boardgameId,"topRecords":true,"perPage":5,"title":`Featured games`,}});}
      
     Col}
     { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"lg":6,"class":`mt-3`,}});
      
       { const $$_olEemagdraoB3C = __sveltets_2_ensureComponent(BoardgameElo); new $$_olEemagdraoB3C({ target: __sveltets_2_any(), props: {     "initial":data.rankings,boardgameId,"top":true,"perPage":6,}});}
     Col}
   Row}
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Page__SvelteComponent_ = ReturnType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;