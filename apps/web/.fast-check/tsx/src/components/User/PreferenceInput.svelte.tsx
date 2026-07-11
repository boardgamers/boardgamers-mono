///<reference types="svelte" />
;
import { createEventDispatcher } from "svelte";
import { FormGroup, Input, Label } from "@/modules/cdk";
import Checkbox from "@/modules/cdk/Checkbox.svelte";
import type { GameInfoOption } from "@bgs/types";
import { oneLineMarked } from "@/utils";
function $$render() {

  
  
  
  
  

  const dispatch = createEventDispatcher<{ change: string | boolean }>();

   let item!: GameInfoOption/*Ωignore_startΩ*/;item = __sveltets_2_any(item);/*Ωignore_endΩ*/;
   let value!: any/*Ωignore_startΩ*/;value = __sveltets_2_any(value);/*Ωignore_endΩ*/;

  function handleChange(val: string | boolean) {
    value = val;
    dispatch("change", val);
  }
;
async () => {

if(item.type === "checkbox"){
   { const $$_xobkcehC0C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC0 = new $$_xobkcehC0C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"checked":value,}});$$_xobkcehC0.$on("change", (event) => handleChange(event.target.checked));
    item.label;
   Checkbox}
} else if (item.type === "select"){
   { const $$_puorGmroF0C = __sveltets_2_ensureComponent(FormGroup); new $$_puorGmroF0C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"class":`d-flex align-items-center mt-2`,}});
     { const $$_lebaL1C = __sveltets_2_ensureComponent(Label); new $$_lebaL1C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"class":`nowrap me-2 mb-0`,}}); oneLineMarked(item.label); Label}
     { const $$_tupnI1C = __sveltets_2_ensureComponent(Input); const $$_tupnI1 = new $$_tupnI1C({ target: __sveltets_2_any(), props: {      children:() => { return __sveltets_2_any(0); },"type":`select`,value,"bsSize":`sm`,}});$$_tupnI1.$on("change", (event) => handleChange(event.target.value));
        for(let option of __sveltets_2_ensureArray(item.items)){
         { svelteHTML.createElement("option", { "value":option.name,});option.label; }
      }
     Input}
   FormGroup}
}
};
return { props: {item: item , value: value} as {item: GameInfoOption, value: any}, exports: {}, bindings: "", slots: {}, events: {...__sveltets_2_toEventTypings<{ change: string | boolean }>()} }}
const PreferenceInput__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type PreferenceInput__SvelteComponent_ = InstanceType<typeof PreferenceInput__SvelteComponent_>;
/*Ωignore_endΩ*/export default PreferenceInput__SvelteComponent_;