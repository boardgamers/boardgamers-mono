///<reference types="svelte" />
;
import { createWatcher, handleError } from "@/utils";
import PreferenceInput from "./PreferenceInput.svelte";
import type { GameInfo } from "@bgs/models";
import type { Primitive } from "type-fest";
import { gamePreferences, addDefaults, updatePreference, loadGamePreferences } from "@/lib/game-preferences.svelte";
import { account } from "@/lib/stores.svelte";
function $$render() {
/*Ωignore_startΩ*/;let $gamePreferences = __sveltets_2_store_get(gamePreferences);;let $account = __sveltets_2_store_get(account);/*Ωignore_endΩ*/
  
  
  
  
  
  

  let gameInfo: GameInfo/*Ωignore_startΩ*/;gameInfo = __sveltets_2_any(gameInfo);/*Ωignore_endΩ*/;
  

  let  boardgameId = __sveltets_2_invalidate(() => gameInfo._id.game);
  let  boardgameVersion = __sveltets_2_invalidate(() => gameInfo._id.version);

  let  preferences = __sveltets_2_invalidate(() => addDefaults($gamePreferences[boardgameId], gameInfo)?.preferences || {});

  let shownCategories: Record<string, boolean> = {};

  const preferenceItems = gameInfo?.viewer?.alternate?.url
    ? [
        { name: "alternateUI", label: "Use alternate UI", type: "checkbox", items: null, category: null },
        ...gameInfo.preferences,
      ]
    : gameInfo.preferences;

  const handleChange = (key: string, val: Primitive) => {
    updatePreference(boardgameId, boardgameVersion, key, val).catch(handleError);
  };

  const loadPrefs = createWatcher(() => loadGamePreferences(boardgameId));

  ;() => {$: (loadPrefs(), [$account?._id]);}
;
async () => {

  for(let item of __sveltets_2_ensureArray(preferenceItems.filter((item) => item.type === "checkbox" && item.category == null))){
   { const $$_tupnIecnereferP0C = __sveltets_2_ensureComponent(PreferenceInput); const $$_tupnIecnereferP0 = new $$_tupnIecnereferP0C({ target: __sveltets_2_any(), props: {     item,"value":preferences[item.name],}});$$_tupnIecnereferP0.$on("change", (event) => handleChange(item.name, event.detail));}
}
  for(let item of __sveltets_2_ensureArray(preferenceItems.filter((item) => item.type === "select" && item.category == null))){
   { const $$_tupnIecnereferP0C = __sveltets_2_ensureComponent(PreferenceInput); const $$_tupnIecnereferP0 = new $$_tupnIecnereferP0C({ target: __sveltets_2_any(), props: {     item,"value":preferences[item.name],}});$$_tupnIecnereferP0.$on("change", (event) => handleChange(item.name, event.detail));}
}
  for(let category of __sveltets_2_ensureArray(preferenceItems.filter((item) => item.type === "category"))){
   { svelteHTML.createElement("a", {     "href":`#${category.name}`,"on:click":() => (shownCategories[category.name] = !shownCategories[category.name]),});category.label; }
  if(shownCategories[category.name]){
     { svelteHTML.createElement("div", { "class":`ms-2 mt-2`,});
        for(let item of __sveltets_2_ensureArray(preferenceItems.filter((item) => item.category === category.name))){
         { const $$_tupnIecnereferP1C = __sveltets_2_ensureComponent(PreferenceInput); const $$_tupnIecnereferP1 = new $$_tupnIecnereferP1C({ target: __sveltets_2_any(), props: {      item,"value":preferences[item.name],}});$$_tupnIecnereferP1.$on("change", (event) => handleChange(item.name, event.detail));}
      }
     }
  }
}
};
return { props: {game: gameInfo} as {game: GameInfo}, exports: {}, bindings: "", slots: {}, events: {} }}
const PreferencesChooser__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type PreferencesChooser__SvelteComponent_ = InstanceType<typeof PreferencesChooser__SvelteComponent_>;
/*Ωignore_endΩ*/export default PreferencesChooser__SvelteComponent_;