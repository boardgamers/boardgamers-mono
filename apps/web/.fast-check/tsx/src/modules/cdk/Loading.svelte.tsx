///<reference types="svelte" />
;
import Spinner from "./Spinner.svelte";

;type $$ComponentProps =  {
    loading?: boolean;
  };function $$render() {

  

  let {
    loading = false,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

/*Ωignore_startΩ*/;const __sveltets_createSlot = __sveltets_2_createCreateSlot();/*Ωignore_endΩ*/;
async () => {

if(loading){
   { svelteHTML.createElement("div", { "class":`text-center`,}); { const $$_rennipS1C = __sveltets_2_ensureComponent(Spinner); new $$_rennipS1C({ target: __sveltets_2_any(), props: {  "color":`secondary`,}});} }
}else{
   { __sveltets_createSlot("default", {});}
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {'default': {}}, events: {} }}
const Loading__SvelteComponent_ = __sveltets_2_isomorphic_component_slots(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Loading__SvelteComponent_ = InstanceType<typeof Loading__SvelteComponent_>;
/*Ωignore_endΩ*/export default Loading__SvelteComponent_;