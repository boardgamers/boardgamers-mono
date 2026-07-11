///<reference types="svelte" />
;
import PreferencesChooser from "@/components/User/PreferencesChooser.svelte";
import { Icon } from "@/modules/cdk";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import { getContext } from "svelte";
import infoCircleFill from "@iconify/icons-bi/info-circle-fill.js";
function $$render() {

  
  
  
  
  

  const { gameInfo } = getContext("game") as GameContext/*Ωignore_startΩ*/;let $gameInfo = __sveltets_2_store_get(gameInfo);/*Ωignore_endΩ*/;

  let  showPreferences =
    __sveltets_2_invalidate(() => !!$gameInfo?.viewer?.alternate?.url || $gameInfo?.preferences?.some((item) => item.type !== "hidden") > 0);
;
async () => {

if(showPreferences){
   { svelteHTML.createElement("div", { "class":`mt-75`,});
     { svelteHTML.createElement("h3", {});
      
       { svelteHTML.createElement("a", { "href":`/page/${$gameInfo._id.game}/preferences`,});
         { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "icon":infoCircleFill,"class":`small`,}});}
       }
     }
     { const $$_resoohCsecnereferP1C = __sveltets_2_ensureComponent(PreferencesChooser); new $$_resoohCsecnereferP1C({ target: __sveltets_2_any(), props: {  "game":$gameInfo,}});}
   }
}
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const GamePreferences__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type GamePreferences__SvelteComponent_ = InstanceType<typeof GamePreferences__SvelteComponent_>;
/*Ωignore_endΩ*/export default GamePreferences__SvelteComponent_;