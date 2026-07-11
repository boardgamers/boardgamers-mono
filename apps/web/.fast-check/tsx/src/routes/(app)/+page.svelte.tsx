///<reference types="svelte" />
;
import { SEO, GameListSidebar } from "@/components";
import marked from "marked";
import { Col, Row } from "@/modules/cdk";
import GameList from "@/components/Game/GameList.svelte";
import { activeGames } from "@/lib/stores.svelte";
import { account } from "@/lib/account.svelte";
function $$render() {
/*Ωignore_startΩ*/;let $activeGames = __sveltets_2_store_get(activeGames);;let $account = __sveltets_2_store_get(account);/*Ωignore_endΩ*/
  
  
  
  
  
  /*Ωignore_startΩ*/;type $$ComponentProps = { data: import('./$types.js').PageData };/*Ωignore_endΩ*/
  let { data }: $$ComponentProps = $props();
  let announcement = $derived(data.announcement);
;
async () => {

 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {}});}

 { svelteHTML.createElement("div", { "class":`d-flex`,});
   { const $$_rabediStsiLemaG1C = __sveltets_2_ensureComponent(GameListSidebar); new $$_rabediStsiLemaG1C({ target: __sveltets_2_any(), props: {}});}

   { svelteHTML.createElement("div", { "class":`container`,});
     { svelteHTML.createElement("div", {   "class":`lead py-2`,"style":`display: flex; flex-direction: column`,});
       { svelteHTML.createElement("p", { "class":`text-center`,});
          { svelteHTML.createElement("b", {}); { svelteHTML.createElement("a", {   "class":`no-link`,"href":`/boardgame/gaia-project`,});  } }
         { svelteHTML.createElement("b", {}); { svelteHTML.createElement("a", {   "class":`no-link`,"href":`/boardgame/powergrid`,});  } }
         { svelteHTML.createElement("b", {}); { svelteHTML.createElement("a", {   "class":`no-link`,"href":`/boardgame/take6`,});  } }
          { svelteHTML.createElement("b", {}); { svelteHTML.createElement("a", {   "class":`no-link`,"href":`/boardgame/container`,});  } }  { svelteHTML.createElement("br", {});}     
         
         { svelteHTML.createElement("a", { "href":`https://discord.gg/EgqK3rD`,});  }
       }
       { svelteHTML.createElement("div", { "class":`mx-auto card border-accent px-3 pb-3 d-block`,});
         { svelteHTML.createElement("div", { "class":`text-center announcement-title py-1`,});data.announcement?.title; }
         { svelteHTML.createElement("div", { "class":`text-start announcement-content`,});
           marked(data.announcement?.content || "");
         }
       }
     }
     { const $$_woR2C = __sveltets_2_ensureComponent(Row); new $$_woR2C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
       { const $$_loC3C = __sveltets_2_ensureComponent(Col); new $$_loC3C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"lg":`6`,"class":`mt-3`,}});
        if($activeGames?.length){
           { const $$_tsiLemaG4C = __sveltets_2_ensureComponent(GameList); new $$_tsiLemaG4C({ target: __sveltets_2_any(), props: {        "gameStatus":`active`,"userId":$account?._id,"perPage":5,"title":`My games`,}});}
        }else{
           { const $$_tsiLemaG4C = __sveltets_2_ensureComponent(GameList); new $$_tsiLemaG4C({ target: __sveltets_2_any(), props: {      "gameStatus":`active`,"topRecords":true,"perPage":5,"title":`Featured games`,}});}
        }
       Col}
       { const $$_loC3C = __sveltets_2_ensureComponent(Col); new $$_loC3C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"lg":`6`,"class":`mt-3`,}});
         { const $$_tsiLemaG4C = __sveltets_2_ensureComponent(GameList); new $$_tsiLemaG4C({ target: __sveltets_2_any(), props: {      "sample":true,"perPage":5,"gameStatus":`open`,"title":`Lobby`,}});}
       Col}
     Row}
     { svelteHTML.createElement("div", { "class":`text-center mt-3`,});
       { svelteHTML.createElement("a", {     "class":`btn btn-accent`,"href":`/games`,"role":`button`,});  }
       { svelteHTML.createElement("a", {       "class":`btn btn-primary ms-3`,"href":`/new-game`,"role":`button`,"data-sveltekit-preload-data":`hover`,});  }
     }
   }
 }


};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Page__SvelteComponent_ = ReturnType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;