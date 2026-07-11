///<reference types="svelte" />
;
import GameListSidebar from "@/components/Layout/GameListSidebar.svelte";
function $$render() {

  /*Ωignore_startΩ*/;type $$ComponentProps = { children: import('svelte').Snippet };/*Ωignore_endΩ*/
  let { children }: $$ComponentProps = $props();
;
async () => {

 { svelteHTML.createElement("div", { "class":`d-flex`,});
   { const $$_rabediStsiLemaG1C = __sveltets_2_ensureComponent(GameListSidebar); new $$_rabediStsiLemaG1C({ target: __sveltets_2_any(), props: {}});}
  ;__sveltets_2_ensureSnippet(children());
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Layout__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Layout__SvelteComponent_ = ReturnType<typeof Layout__SvelteComponent_>;
/*Ωignore_endΩ*/export default Layout__SvelteComponent_;