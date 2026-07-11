///<reference types="svelte" />
;
import { Button, Icon } from "@/modules/cdk";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import skipBackwardFill from "@iconify/icons-bi/skip-backward-fill.js";
import skipForwardFill from "@iconify/icons-bi/skip-forward-fill.js";
import skipStartFill from "@iconify/icons-bi/skip-start-fill.js";
import skipEndFill from "@iconify/icons-bi/skip-end-fill.js";
import stopFill from "@iconify/icons-bi/stop-fill.js";

import { getContext } from "svelte";
import { sidebarOpen } from "@/lib/stores.svelte";
import Portal from "@/modules/portal/Portal.svelte";
function $$render() {
/*Ωignore_startΩ*/;let $sidebarOpen = __sveltets_2_store_get(sidebarOpen);/*Ωignore_endΩ*/
  
  
  
  
  
  
  

  
  
  

  const { gameInfo, replayData, emitter } = getContext("game") as GameContext/*Ωignore_startΩ*/;let $gameInfo = __sveltets_2_store_get(gameInfo);;let $replayData = __sveltets_2_store_get(replayData);/*Ωignore_endΩ*/;

  function startReplay() {
    emitter.emit("replay:start");
  }

  function replayTo(dest: number) {
    emitter.emit("replay:to", dest);
  }

  function endReplay() {
    emitter.emit("replay:end");
  }
;
async () => {

if($gameInfo?.viewer?.replayable){
   { svelteHTML.createElement("div", { "class":`mt-75`,});
    if(!$replayData){
       { const $$_nottuB1C = __sveltets_2_ensureComponent(Button); const $$_nottuB1 = new $$_nottuB1C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"color":`accent`,"size":`sm`,}});$$_nottuB1.$on("click", startReplay);  Button}
    }else{
       { svelteHTML.createElement("div", { "class":`d-flex align-items-center`,});
         { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"size":`sm`,"class":`me-1`,}});$$_nottuB2.$on("click", () => replayTo($replayData.start));
           { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "icon":skipBackwardFill,"style":`margin-bottom: 0.25em`,}});}
         Button}
         { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"size":`sm`,"class":`mx-1`,}});$$_nottuB2.$on("click", () => replayTo(Math.max($replayData.start, $replayData.current - 1)));
           { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "icon":skipStartFill,"style":`margin-bottom: 0.25em`,}});}
         Button}
         { svelteHTML.createElement("span", {     "class":`mx-1 text-center`,"style":`text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex-grow: 1`,});
          $replayData.current;  $replayData.end;
         }
         { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"size":`sm`,"class":`mx-1`,}});$$_nottuB2.$on("click", () => replayTo(Math.min($replayData.end, $replayData.current + 1)));
           { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "icon":skipEndFill,"style":`margin-bottom: 0.25em`,}});}
         Button}
         { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"size":`sm`,"class":`mx-1`,}});$$_nottuB2.$on("click", () => replayTo($replayData.end));
           { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "icon":skipForwardFill,"style":`margin-bottom: 0.25em`,}});}
         Button}
         { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"size":`sm`,"class":`ms-1`,}});$$_nottuB2.$on("click", endReplay);
           { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "icon":stopFill,"style":`margin-bottom: 0.25em; color: orange`,}});}
         Button}
       }
    }
   }
}
if($replayData && !$sidebarOpen){
   { const $$_latroP0C = __sveltets_2_ensureComponent(Portal); new $$_latroP0C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"target":`#floating-controls`,}});
     { svelteHTML.createElement("div", {     "style":`position: fixed; bottom: 0; left: 0; right: calc(var(--fab-right) + 8em); pointer-events: none`,"class":`d-flex pb-3 text-light`,});
       { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {       children:() => { return __sveltets_2_any(0); },"size":`sm`,"class":`me-1 ms-auto`,"style":`pointer-events: all`,}});$$_nottuB2.$on("click", () => replayTo($replayData.start));
         { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "icon":skipBackwardFill,"style":`margin-bottom: 0.25em`,}});}
       Button}
       { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {         children:() => { return __sveltets_2_any(0); },"size":`sm`,"class":`mx-1`,"style":`pointer-events: all`,}});$$_nottuB2.$on("click", () => replayTo(Math.max($replayData.start, $replayData.current - 1)));
         { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "icon":skipStartFill,"style":`margin-bottom: 0.25em`,}});}
       Button}
       { svelteHTML.createElement("span", {     "class":`mx-1 px-1 text-center`,"style":`
        text-overflow: ellipsis;
        display: inline-flex;
        align-items: center;
        overflow: hidden;
        white-space: nowrap;
        background-color: var(--bs-secondary);
        border-radius: 0.2em;
        pointer-events: all
      `,});
        $replayData.current;  $replayData.end;
       }
       { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {         children:() => { return __sveltets_2_any(0); },"size":`sm`,"class":`mx-1`,"style":`pointer-events: all`,}});$$_nottuB2.$on("click", () => replayTo(Math.min($replayData.end, $replayData.current + 1)));
         { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "icon":skipEndFill,"style":`margin-bottom: 0.25em`,}});}
       Button}
       { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {       children:() => { return __sveltets_2_any(0); },"size":`sm`,"class":`mx-1`,"style":`pointer-events: all`,}});$$_nottuB2.$on("click", () => replayTo($replayData.end));
         { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "icon":skipForwardFill,"style":`margin-bottom: 0.25em`,}});}
       Button}
       { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {       children:() => { return __sveltets_2_any(0); },"size":`sm`,"class":`ms-1 me-auto`,"style":`pointer-events: all`,}});$$_nottuB2.$on("click", endReplay);
         { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {    "icon":stopFill,"style":`margin-bottom: 0.25em; color: orange`,}});}
       Button}
     }
   Portal}
}
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const ReplayControls__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type ReplayControls__SvelteComponent_ = InstanceType<typeof ReplayControls__SvelteComponent_>;
/*Ωignore_endΩ*/export default ReplayControls__SvelteComponent_;