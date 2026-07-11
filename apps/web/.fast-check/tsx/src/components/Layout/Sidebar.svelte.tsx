///<reference types="svelte" />
;
import { sidebarOpen } from "@/lib/stores.svelte";
import { Button, Icon } from "@/modules/cdk";
import gear from "@iconify/icons-bi/gear.js";
function $$render() {
/*Ωignore_startΩ*/;let $sidebarOpen = __sveltets_2_store_get(sidebarOpen);/*Ωignore_endΩ*/
  
  
  
;
async () => {

 { svelteHTML.createElement("div", {  "class":`sidebar-container`,});$sidebarOpen;
   { svelteHTML.createElement("aside", { "class":`px-3 pb-3 sidebar thin-scrollbar text-light`,});
     { svelteHTML.createElement("div", {  "id":`sidebar`,});}
   }
   { const $$_nottuB1C = __sveltets_2_ensureComponent(Button); const $$_nottuB1 = new $$_nottuB1C({ target: __sveltets_2_any(), props: {       children:() => { return __sveltets_2_any(0); },"color":`secondary`,"class":"rounded-circle b-avatar sidebar-fab" + (false ? " chatOpen" : ""),}});$$_nottuB1.$on("click", () => ($sidebarOpen = !$sidebarOpen));
     { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {      "icon":gear,"class":`absolute-center`,"style":`width: 1.5rem; height: 1.5rem`,}});}
   Button}
 }


};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const Sidebar__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Sidebar__SvelteComponent_ = InstanceType<typeof Sidebar__SvelteComponent_>;
/*Ωignore_endΩ*/export default Sidebar__SvelteComponent_;