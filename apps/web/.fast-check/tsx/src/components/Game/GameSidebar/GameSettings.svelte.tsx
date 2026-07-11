///<reference types="svelte" />
;
import { Icon, Checkbox, Label, Input, FormGroup } from "@/modules/cdk";
import { handleError, oneLineMarked } from "@/utils";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import infoCircleFill from "@iconify/icons-bi/info-circle-fill.js";
import { getContext } from "svelte";
import { account } from "@/lib/stores.svelte";
import { post, get } from "@/lib/api";
function $$render() {
/*Ωignore_startΩ*/;let $account = __sveltets_2_store_get(account);/*Ωignore_endΩ*/
  
  
  
  
  
  
  

  const { game, gameInfo }: GameContext = getContext("game")/*Ωignore_startΩ*/;let $game = __sveltets_2_store_get(game);;let $gameInfo = __sveltets_2_store_get(gameInfo);/*Ωignore_endΩ*/;
  let settings: Record<string, unknown> | null = null;

  let  userId = __sveltets_2_invalidate(() => $account?._id);
  let  playerUser = __sveltets_2_invalidate(() => $game?.players.find((pl) => pl._id === userId));
  let  gameStatus = __sveltets_2_invalidate(() => $game?.status);
  let  gameId = __sveltets_2_invalidate(() => $game?._id);

  async function loadSettings() {
    if (gameStatus !== "active" || !playerUser || !$gameInfo) {
      settings = null;
      return;
    }
    if ($gameInfo.settings?.length > 0) {
      settings = (await get<typeof settings>(`/gameplay/${gameId}/settings`).catch(handleError)) ?? null;
    } else {
      settings = null;
    }
  }

  ;() => {$: (loadSettings(), [gameStatus, userId, $gameInfo]);}

  async function postSettings() {
    if (!$account) {
      return;
    }
    await post(`/gameplay/${gameId}/settings`, settings as any);
  }
;
async () => {

if($gameInfo?.settings?.length > 0 && $game.status === "active" && settings && playerUser){
   { svelteHTML.createElement("div", { "class":`mt-75`,});
     { svelteHTML.createElement("h3", {});
      
       { svelteHTML.createElement("a", { "href":`/page/${$game.game.name}/settings`,});
         { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "icon":infoCircleFill,"class":`small`,}});}
       }
     }
    
      for(let setting of __sveltets_2_ensureArray($gameInfo.settings)){
      if(!setting.faction || setting.faction === playerUser.faction){
        if(setting.type === "checkbox"){
           { const $$_xobkcehC1C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC1 = new $$_xobkcehC1C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },checked:settings[setting.name],}});/*Ωignore_startΩ*/() => settings[setting.name] = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC1.$$bindings = 'checked';$$_xobkcehC1.$on("change", postSettings);
            setting.label;
           Checkbox}
        } else if (setting.type === "select"){
           { const $$_puorGmroF1C = __sveltets_2_ensureComponent(FormGroup); new $$_puorGmroF1C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"class":`d-flex align-items-center mt-2`,}});
             { const $$_lebaL2C = __sveltets_2_ensureComponent(Label); new $$_lebaL2C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"class":`nowrap me-2 mb-0`,}}); oneLineMarked(setting.label); Label}
             { const $$_tupnI2C = __sveltets_2_ensureComponent(Input); const $$_tupnI2 = new $$_tupnI2C({ target: __sveltets_2_any(), props: {       children:() => { return __sveltets_2_any(0); },"type":`select`,value:settings[setting.name],"bsSize":`sm`,}});/*Ωignore_startΩ*/() => settings[setting.name] = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_tupnI2.$$bindings = 'value';$$_tupnI2.$on("change", postSettings);
                for(let item of __sveltets_2_ensureArray(setting.items)){
                 { svelteHTML.createElement("option", { "value":item.name,});item.label; }
              }
             Input}
           FormGroup}
        }
      }
    }
   }
}
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const GameSettings__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type GameSettings__SvelteComponent_ = InstanceType<typeof GameSettings__SvelteComponent_>;
/*Ωignore_endΩ*/export default GameSettings__SvelteComponent_;