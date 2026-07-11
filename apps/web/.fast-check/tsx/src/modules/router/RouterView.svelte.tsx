///<reference types="svelte" />
;
import { getContext, setContext } from "svelte";
import { route } from "./router";
function $$render() {
/*Ωignore_startΩ*/;let $route = __sveltets_2_store_get(route);/*Ωignore_endΩ*/
  
  

  const key = "router-context-key";

  let n = getContext<number>(key) ?? 0;
  setContext(key, n + 1);

/*Ωignore_startΩ*/;const __sveltets_createSlot = __sveltets_2_createCreateSlot();/*Ωignore_endΩ*/;
async () => {

if($route && $route.component){
   { const $$_tnenopmoc_etlevs0C = __sveltets_2_ensureComponent($route.layout && n === 0 ? $route.layout : $route.component); new $$_tnenopmoc_etlevs0C({ target: __sveltets_2_any(), props: {   ...$route.props ? $route.props($route) : $route.params,}});}
}else{
   { svelteHTML.createElement("div", {}); { __sveltets_createSlot("default", {});} }
}
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {'default': {}}, events: {} }}
const RouterView__SvelteComponent_ = __sveltets_2_isomorphic_component_slots(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type RouterView__SvelteComponent_ = InstanceType<typeof RouterView__SvelteComponent_>;
/*Ωignore_endΩ*/export default RouterView__SvelteComponent_;