///<reference types="svelte" />
;
import type { Page } from "@sveltejs/kit";
import { Card, Col, Row } from "@/modules/cdk";
import { GameList } from "../Game";
import { page } from "$app/stores";
function $$render() {
/*Ωignore_startΩ*/;let $page = __sveltets_2_store_get(page);/*Ωignore_endΩ*/
  
  
  
  

   let userId: string/*Ωignore_startΩ*/;userId = __sveltets_2_any(userId);/*Ωignore_endΩ*/;

  let  filter = __sveltets_2_invalidate(() => $page.url.searchParams.get("games") ?? "started");

  const generateAlternative = (page: Page) => {
    const query = new URLSearchParams(page.url.searchParams);

    query.set("games", filter === "open" ? "started" : "open");

    return query.toString();
  };

  let  alternativeRoute = __sveltets_2_invalidate(() => "?" + generateAlternative($page));
;
async () => {

 { const $$_draC0C = __sveltets_2_ensureComponent(Card); const $$_draC0 = new $$_draC0C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"class":`mt-4 border-secondary`,"header":`Games`,}});
   { const $$_woR1C = __sveltets_2_ensureComponent(Row); new $$_woR1C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
    if(filter === "started"){
       { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"lg":6,}});
         { const $$_tsiLemaG3C = __sveltets_2_ensureComponent(GameList); new $$_tsiLemaG3C({ target: __sveltets_2_any(), props: {       "gameStatus":`active`,"perPage":5,userId,"title":`Active games`,}});}
       Col}
       { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"lg":6,}});
         { const $$_tsiLemaG3C = __sveltets_2_ensureComponent(GameList); new $$_tsiLemaG3C({ target: __sveltets_2_any(), props: {       "gameStatus":`ended`,"perPage":5,userId,"title":`Finished games`,}});}
       Col}
    }else{
       { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"lg":6,}});
         { const $$_tsiLemaG3C = __sveltets_2_ensureComponent(GameList); new $$_tsiLemaG3C({ target: __sveltets_2_any(), props: {       "gameStatus":`open`,"perPage":5,userId,"title":`Open games`,}});}
       Col}
    }
   Row}
   {const {/*Ωignore_startΩ*/$$_$$/*Ωignore_endΩ*/,} = $$_draC0.$$slot_def["footer"];$$_$$;{ svelteHTML.createElement("a", {   "href":alternativeRoute,});
    filter === "started" ? "Open games" : "Started games";
   }}
 Card}
};
return { props: {userId: userId} as {userId: string}, exports: {}, bindings: "", slots: {}, events: {} }}
const UserGames__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type UserGames__SvelteComponent_ = InstanceType<typeof UserGames__SvelteComponent_>;
/*Ωignore_endΩ*/export default UserGames__SvelteComponent_;