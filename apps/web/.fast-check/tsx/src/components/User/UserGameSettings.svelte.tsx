///<reference types="svelte" />
;
import { set } from "lodash";
import type { GameInfo } from "@bgs/models";
import { handleError, confirm, classnames } from "@/utils";
import Card from "@/modules/cdk/Card.svelte";
import { CardText, FormGroup, Input } from "@/modules/cdk";
import Checkbox from "@/modules/cdk/Checkbox.svelte";
import Loading from "@/modules/cdk/Loading.svelte";
import PreferencesChooser from "./PreferencesChooser.svelte";
import { post } from "@/lib/api";
import { gameInfoKey } from "@/lib/game-info.svelte";
import { developerSettings, devGameSettings } from "@/lib/stores.svelte";
import { gamePreferences, loadGamePreferences } from "@/lib/game-preferences.svelte";
function $$render() {
/*Ωignore_startΩ*/;let $developerSettings = __sveltets_2_store_get(developerSettings);;let $devGameSettings = __sveltets_2_store_get(devGameSettings);;let $gamePreferences = __sveltets_2_store_get(gamePreferences);/*Ωignore_endΩ*/
  
  
  
  
  
  
  
  
  
  
  
  

   let title = "";
   let game: GameInfo/*Ωignore_startΩ*/;game = __sveltets_2_any(game);/*Ωignore_endΩ*/;
  let className = "";
  

  ;() => {$: loadGamePreferences(game._id.game);}

  let  prefs = __sveltets_2_invalidate(() => $gamePreferences[game._id.game]);

  let  ownership = __sveltets_2_invalidate(() => prefs?.access?.ownership ?? false);

  async function postOwnership(event: Event) {
    const newVal = (event.target! as HTMLInputElement).checked;

    if (newVal) {
      const res = await confirm("I certify on my honor that I own a copy of the game");

      if (!res) {
        ownership = false;
        (event.target! as HTMLInputElement).checked = false;
        return;
      }
    }

    try {
      await post(`/account/games/${game._id.game}/ownership`, {
        access: { ...prefs.access, ownership: newVal },
      });
      prefs.access = { ...prefs.access, ownership: newVal };
    } catch (err) {
      handleError(err);
    }
  }

  let  classes = __sveltets_2_invalidate(() => classnames(className, "border-secondary"));
  let  key = __sveltets_2_invalidate(() => gameInfoKey(game._id.game, game._id.version));

  let customViewerUrl = $devGameSettings[gameInfoKey(game._id.game, game._id.version)]?.viewerUrl;

  function updateDevSettings() {
    set($devGameSettings, `${key}.viewerUrl`, customViewerUrl);
    $devGameSettings = { ...$devGameSettings };
  }

  function updateViewerUrl() {
    $devGameSettings[key]?.viewerUrl;
  }

  ;() => {$: (updateDevSettings(), [customViewerUrl]);}
  ;() => {$: (updateViewerUrl(), [key]);}
;
async () => {

 { const $$_draC0C = __sveltets_2_ensureComponent(Card); new $$_draC0C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"class":classes,"header":title || game.label,}});
   { const $$_txeTdraC1C = __sveltets_2_ensureComponent(CardText); new $$_txeTdraC1C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"class":`h-100 d-flex`,"style":`flex-direction: column`,}});
     { const $$_gnidaoL2C = __sveltets_2_ensureComponent(Loading); new $$_gnidaoL2C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"loading":!prefs,}});
       { svelteHTML.createElement("div", { "style":`flex-grow: 1`,});
         { const $$_xobkcehC4C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC4 = new $$_xobkcehC4C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"checked":ownership,}});$$_xobkcehC4.$on("change", postOwnership);    Checkbox}
        if(game.preferences?.length > 0){
           { svelteHTML.createElement("hr", {});}
           { const $$_resoohCsecnereferP4C = __sveltets_2_ensureComponent(PreferencesChooser); new $$_resoohCsecnereferP4C({ target: __sveltets_2_any(), props: { game,}});}
        }
       }
      if($developerSettings){
         { svelteHTML.createElement("hr", {});}
         { const $$_puorGmroF3C = __sveltets_2_ensureComponent(FormGroup); new $$_puorGmroF3C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
           { svelteHTML.createElement("label", { "for":`viewerUrl`,});   key;  }
           { const $$_tupnI4C = __sveltets_2_ensureComponent(Input); const $$_tupnI4 = new $$_tupnI4C({ target: __sveltets_2_any(), props: {      "type":`text`,"placeholder":`Viewer URL`,value:customViewerUrl,}});/*Ωignore_startΩ*/() => customViewerUrl = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_tupnI4.$$bindings = 'value';}
         FormGroup}
      }
     Loading}
   CardText}
 Card}
};
return { props: {title: title , game: game , class: className} as {title?: typeof title, game: GameInfo, class?: typeof className}, exports: {}, bindings: "", slots: {}, events: {} }}
const UserGameSettings__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type UserGameSettings__SvelteComponent_ = InstanceType<typeof UserGameSettings__SvelteComponent_>;
/*Ωignore_endΩ*/export default UserGameSettings__SvelteComponent_;