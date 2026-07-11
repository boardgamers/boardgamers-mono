///<reference types="svelte" />
;
import "bootstrap/dist/css/bootstrap.min.css";
import "../../style.css";

import { Appbar, Sidebar } from "@/components";
import { activeGames } from "@/lib/stores.svelte";
import { initNProgress } from "@/lib/nprogress.svelte";
function $$render() {
/*Ωignore_startΩ*/;let $activeGames = __sveltets_2_store_get(activeGames);/*Ωignore_endΩ*/
  
  

  
  
  

  initNProgress();/*Ωignore_startΩ*/;type $$ComponentProps = { data: import('./$types.js').LayoutData, children: import('svelte').Snippet };/*Ωignore_endΩ*/

  let { data, children }: $$ComponentProps = $props();
;
async () => {

 { svelteHTML.createElement("svelte:head", {});
   { svelteHTML.createElement("link", {         "rel":`shortcut icon`,"type":`image/png`,"id":`favicon-site`,"href":$activeGames.length > 0 ? "/favicon-active.ico" : "/favicon.ico",});}
 }

 { svelteHTML.createElement("div", { "id":`app`,});
   { svelteHTML.createElement("div", { "id":`app-layout`,});
     { svelteHTML.createElement("div", { "style":`flex-grow: 1; display: flex; flex-direction: column`,});
       { const $$_rabppA3C = __sveltets_2_ensureComponent(Appbar); new $$_rabppA3C({ target: __sveltets_2_any(), props: {  "class":`mb-3`,}});}
       { svelteHTML.createElement("main", { "class":`container-fluid p-relative mb-auto`,});
        ;__sveltets_2_ensureSnippet(children());
       }
     }
     { const $$_rabediS2C = __sveltets_2_ensureComponent(Sidebar); new $$_rabediS2C({ target: __sveltets_2_any(), props: {}});}
   }
 }


};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Layout__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Layout__SvelteComponent_ = ReturnType<typeof Layout__SvelteComponent_>;
/*Ωignore_endΩ*/export default Layout__SvelteComponent_;