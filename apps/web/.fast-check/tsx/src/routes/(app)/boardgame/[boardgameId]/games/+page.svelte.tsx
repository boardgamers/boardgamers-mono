///<reference types="svelte" />
;
import { fade } from "svelte/transition";
import { GameList, SEO } from "@/components";
import { Col, Container, Nav, NavItem, NavLink } from "@/modules/cdk";
import type { LoadGamesResult } from "@/lib/games.svelte";
import { gameInfo } from "@/lib/game-info.svelte";

;type $$ComponentProps =  {
    data: {
      boardgameId: string;
      featured: LoadGamesResult;
      lobby: LoadGamesResult;
      firstTab: boolean;
    };
  };function $$render() {

  
  
  
  
  

  let {
    data,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let firstTab = $state(data.firstTab);

  let animating = $state(false);
  let featuredCount = $derived(data.featured?.games ?? []);
  let lobbyCount = $derived(data.lobby?.total ?? 0);
;
async () => {


 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {     "title":`${gameInfo(data.boardgameId, "latest").label} games`,"description":`${featuredCount} ongoing games and ${lobbyCount} open games.`,}});}

 { const $$_reniatnoC0C = __sveltets_2_ensureComponent(Container); new $$_reniatnoC0C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
   { const $$_vaN1C = __sveltets_2_ensureComponent(Nav); new $$_vaN1C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },"pills":true,}});
     { svelteHTML.createElement("h1", { "class":`me-3`,});  }
     { const $$_metIvaN2C = __sveltets_2_ensureComponent(NavItem); new $$_metIvaN2C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}}); { const $$_kniLvaN3C = __sveltets_2_ensureComponent(NavLink); const $$_kniLvaN3 = new $$_kniLvaN3C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"href":`#`,"active":firstTab,}});$$_kniLvaN3.$on("click", () => (firstTab = true));  NavLink} NavItem}
     { const $$_metIvaN2C = __sveltets_2_ensureComponent(NavItem); new $$_metIvaN2C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}}); { const $$_kniLvaN3C = __sveltets_2_ensureComponent(NavLink); const $$_kniLvaN3 = new $$_kniLvaN3C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"href":`#`,"active":!firstTab,}});$$_kniLvaN3.$on("click", () => (firstTab = false));  NavLink} NavItem}
   Nav}

  if(firstTab){
     { svelteHTML.createElement("div", {         "class":`mt-2 row`,"on:outroend":() => (animating = false),"on:outrostart":() => (animating = true),});__sveltets_2_ensureTransition(fade(svelteHTML.mapElementTag('div')));animating;
       { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"md":`6`,"class":`mb-2`,}});
         { const $$_tsiLemaG3C = __sveltets_2_ensureComponent(GameList); new $$_tsiLemaG3C({ target: __sveltets_2_any(), props: {      "gameStatus":`open`,"title":`Lobby`,"boardgameId":data.boardgameId,}});}
       Col}
       { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"md":`6`,"class":`mb-2`,}});
         { const $$_tsiLemaG3C = __sveltets_2_ensureComponent(GameList); new $$_tsiLemaG3C({ target: __sveltets_2_any(), props: {      "gameStatus":`active`,"title":`Ongoing`,"boardgameId":data.boardgameId,}});}
       Col}
     }
  }else{
     { svelteHTML.createElement("div", {         "class":`mt-2 row`,"on:outroend":() => (animating = false),"on:outrostart":() => (animating = true),});__sveltets_2_ensureTransition(fade(svelteHTML.mapElementTag('div')));animating;
       { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"md":`6`,"class":`mb-2`,}});
         { const $$_tsiLemaG3C = __sveltets_2_ensureComponent(GameList); new $$_tsiLemaG3C({ target: __sveltets_2_any(), props: {      "gameStatus":`ended`,"title":`Finished`,"boardgameId":data.boardgameId,}});}
       Col}
     }
  }
 Container}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Page__SvelteComponent_ = ReturnType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;