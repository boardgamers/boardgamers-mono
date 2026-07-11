///<reference types="svelte" />
;
import { Card, CardText, Col } from "@/modules/cdk";
import { goto } from "$app/navigation";
import { createWatcher } from "@/utils";
import marked from "marked";
import { latestGameInfos } from "@/lib/game-info.svelte";
import { gamePreferences, loadAllGamePreferences } from "@/lib/game-preferences.svelte";
import { account } from "@/lib/account.svelte";
import { SEO } from "@/components";
function $$render() {
/*Ωignore_startΩ*/;let $gamePreferences = __sveltets_2_store_get(gamePreferences);;let $account = __sveltets_2_store_get(account);/*Ωignore_endΩ*/
  
  
  
  
  
  
  
  

  let info = latestGameInfos();

  const watcher = createWatcher(loadAllGamePreferences);
  ;() => {$: (watcher(), [$account?._id]);}
;
async () => {

 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {  "title":`Game selection`,}});}

 { svelteHTML.createElement("div", { "class":`container`,});
   { svelteHTML.createElement("h1", { "class":`mb-4`,});  }
   { svelteHTML.createElement("div", { "class":`row row-cols-1 row-cols-md-3 g-4 game-choice`,});
      for(let game of __sveltets_2_ensureArray(info)){
       { const $$_loC2C = __sveltets_2_ensureComponent(Col); new $$_loC2C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
         { const $$_draC3C = __sveltets_2_ensureComponent(Card); const $$_draC3 = new $$_draC3C({ target: __sveltets_2_any(), props: {         children:() => { return __sveltets_2_any(0); },"header":game.label,"class":`border-secondary h-100`,"role":`button`,}});$$_draC3.$on("click", () => goto(`/boardgame/${game._id.game}`));
           { const $$_txeTdraC4C = __sveltets_2_ensureComponent(CardText); new $$_txeTdraC4C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
             marked(game.description);
           CardText}
           {const {/*Ωignore_startΩ*/$$_$$/*Ωignore_endΩ*/,} = $$_draC3.$$slot_def["footer"];$$_$$;{ svelteHTML.createElement("span", {    });$gamePreferences[game._id.game]?.access?.ownership;!$gamePreferences[game._id.game]?.access?.ownership;
            if($gamePreferences[game._id.game]?.access?.ownership){   }else{     }
           }}
         Card}
       Col}
    }
   }
 }
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Page__SvelteComponent_ = InstanceType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;