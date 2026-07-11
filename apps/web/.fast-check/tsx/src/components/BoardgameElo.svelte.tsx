///<reference types="svelte" />
;
import { loadEloRankings, type EloRanking } from "@/lib/elo-rankings.svelte";
import { Loading, Pagination } from "@/modules/cdk";
import { createWatcher, handleError, pluralize } from "@/utils";
import UserAvatar from "./User/UserAvatar.svelte";
function $$render() {

  
  
  
  

   let boardgameId: string/*Ωignore_startΩ*/;boardgameId = __sveltets_2_any(boardgameId);/*Ωignore_endΩ*/;
   let top = false/*Ωignore_startΩ*/;top = __sveltets_2_any(top);/*Ωignore_endΩ*/;
   let perPage = 5;
   let baseUrl: string | undefined = undefined/*Ωignore_startΩ*/;baseUrl = __sveltets_2_any(baseUrl);/*Ωignore_endΩ*/;
   let initial: { rankings: EloRanking[]; total: number } | void = undefined/*Ωignore_startΩ*/;initial = __sveltets_2_any(initial);/*Ωignore_endΩ*/;
   let currentPage = 0;

  let count = initial?.total ?? 0;
  let boardgameElo: EloRanking[] = initial?.rankings ?? [];
  let loading = !initial;

  let  title = __sveltets_2_invalidate(() => top ? "Top ranked players" : "Elo");

  async function load(refresh: boolean) {
    try {
      const result = await loadEloRankings({
        boardgameId,
        count: perPage,
        skip: currentPage * perPage,
        fetchCount: !top && refresh,
      });

      boardgameElo = result.rankings;
      count = refresh ? result.total : count;
    } catch (err) {
      handleError(err);
    } finally {
      loading = false;
    }
  }

  const reload = createWatcher(() => load(true), { immediate: !initial });

  ;() => {$: (reload(), [boardgameId]);}

  const onPageChange = createWatcher(() => !baseUrl && load(false));

  ;() => {$: {
    if (baseUrl && initial) {
      boardgameElo = initial.rankings;
    }
  }}

  ;() => {$: (onPageChange(), [currentPage]);}
;
async () => {

 { svelteHTML.createElement("div", {});
   { svelteHTML.createElement("h3", {});title; }
   { const $$_gnidaoL1C = __sveltets_2_ensureComponent(Loading); new $$_gnidaoL1C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },loading,}});
     { svelteHTML.createElement("ul", { "class":`list-group text-start`,});
         for(let bgElo of __sveltets_2_ensureArray(boardgameElo)){let pos = 1;
         { svelteHTML.createElement("a", {   "href":`/user/${bgElo.user.name}#elo`,"class":`list-group-item list-group-item-action`,});
           { const $$_ratavAresU4C = __sveltets_2_ensureComponent(UserAvatar); new $$_ratavAresU4C({ target: __sveltets_2_any(), props: {      "username":bgElo.user.name,"userId":bgElo.user._id,"size":`2rem`,}});}
           { svelteHTML.createElement("span", { "class":`ms-2`,});
             { svelteHTML.createElement("b", {});pos + 1 + currentPage * perPage; }  bgElo.user.name; 
             { svelteHTML.createElement("b", {});bgElo.elo.value; }   pluralize(bgElo.elo.games, "game");
           }
         }
      }
     }
    if(!top){
       { const $$_noitanigaP2C = __sveltets_2_ensureComponent(Pagination); const $$_noitanigaP2 = new $$_noitanigaP2C({ target: __sveltets_2_any(), props: {        "class":`mt-1`,"align":`right`,count,currentPage,baseUrl,perPage,}});/*Ωignore_startΩ*/() => currentPage = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_noitanigaP2.$$bindings = 'currentPage';}
    }
   Loading}
 }
};
return { props: {boardgameId: boardgameId , top: top , perPage: perPage , baseUrl: baseUrl , initial: initial , currentPage: currentPage} as {boardgameId: string, top?: typeof top, perPage?: typeof perPage, baseUrl?: string | undefined, initial?: { rankings: EloRanking[]; total: number } | void, currentPage?: typeof currentPage}, exports: {}, bindings: "", slots: {}, events: {} }}
const BoardgameElo__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type BoardgameElo__SvelteComponent_ = InstanceType<typeof BoardgameElo__SvelteComponent_>;
/*Ωignore_endΩ*/export default BoardgameElo__SvelteComponent_;