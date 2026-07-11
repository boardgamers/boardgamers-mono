///<reference types="svelte" />
;
import { browser } from "$app/environment";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import { oneLineMarked } from "@/utils";
import DOMPurify from "dompurify";
import { getContext } from "svelte";
function $$render() {

  
  
  
  
  

  const { log }: GameContext = getContext("game")/*Ωignore_startΩ*/;let $log = __sveltets_2_store_get(log);/*Ωignore_endΩ*/;

  let showLog = browser && !!localStorage.getItem("show-log");
  let logElement: HTMLDivElement;

  // Scroll to top of log
  function onLogChanged() {
    setTimeout(() => {
      if (logElement) {
        logElement.scrollTop = -logElement.scrollHeight;
      }
    });
  }

  ;() => {$: (onLogChanged(), [$log, showLog]);}

  function toggleShowLog() {
    showLog = !showLog;
    localStorage.setItem("show-log", showLog ? "true" : "");
  }

  function logToHtml(log: string) {
    return DOMPurify.sanitize(oneLineMarked(log));
  }
;
async () => {

if($log.length > 0){
   { svelteHTML.createElement("div", { "class":`mt-75 thin-scrollbar`,});
     { svelteHTML.createElement("div", { "class":`d-flex align-items-baseline`,});
       { svelteHTML.createElement("h3", { "class":`mb-0`,});  }
       { svelteHTML.createElement("div", {   "class":`ms-2`,"style":`font-size: smaller`,});
         { svelteHTML.createElement("a", {      "href":showLog ? "#hideLog" : "#showLog","style":`font-weight: unset !important`,"on:click":toggleShowLog,});showLog ? "hide" : "show"; }
       }
     }
    if(showLog){
       { const $$_div1 = svelteHTML.createElement("div", {  "class":`log mt-2`,});logElement = $$_div1;
          for(let item of __sveltets_2_ensureArray($log)){
           { svelteHTML.createElement("div", {});
             logToHtml(item);
           }
        }
       }
    }
   }
}


};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const GameLog__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type GameLog__SvelteComponent_ = InstanceType<typeof GameLog__SvelteComponent_>;
/*Ωignore_endΩ*/export default GameLog__SvelteComponent_;