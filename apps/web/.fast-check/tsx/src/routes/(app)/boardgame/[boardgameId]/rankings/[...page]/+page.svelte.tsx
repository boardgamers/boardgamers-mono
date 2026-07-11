///<reference types="svelte" />
;
import { BoardgameElo, SEO } from "@/components";
import type { LoadEloRankingsResult } from "@/lib/elo-rankings.svelte";
import { gameInfo } from "@/lib/game-info.svelte";
import { Col, Row } from "@/modules/cdk";
import { gameLabel } from "@/utils/game-label";

;type $$ComponentProps =  { data: { rankings: LoadEloRankingsResult; boardgameId: string; currentPage: number; skip: number } };function $$render() {

  
  
  
  
  

  let { data }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ =
    $props();
;
async () => {

 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {     "title":`Page ${data.currentPage} - ${gameLabel(gameInfo(data.boardgameId, "latest").label)} rankings`,"description":data.rankings.rankings
    .map((x, i) => `${data.skip + i + 1}° ${x.user.name} (${x.elo.value} elo)`)
    .join("\n"),}});}

 { svelteHTML.createElement("div", { "class":`container`,});
   { svelteHTML.createElement("h1", {});  }
   { const $$_woR1C = __sveltets_2_ensureComponent(Row); new $$_woR1C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
     { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"md":6,}});
       { const $$_olEemagdraoB3C = __sveltets_2_ensureComponent(BoardgameElo); new $$_olEemagdraoB3C({ target: __sveltets_2_any(), props: {           "boardgameId":data.boardgameId,"initial":data.rankings,"perPage":15,"currentPage":data.currentPage - 1,"baseUrl":`/boardgame/${data.boardgameId}/rankings`,}});}
     Col}
    
   Row}
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Page__SvelteComponent_ = ReturnType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;