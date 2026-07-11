///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    class?: string;
    [key: string]: any;
  };function $$render() {

  

  let {
    class: className = "",
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(classnames(className, "card-text"));

/*Ωignore_startΩ*/;const __sveltets_createSlot = __sveltets_2_createCreateSlot();/*Ωignore_endΩ*/;
async () => {


 { svelteHTML.createElement("div", {  "class":classes,...rest,});
   { __sveltets_createSlot("default", {});}
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {'default': {}}, events: {} }}
const CardText__SvelteComponent_ = __sveltets_2_isomorphic_component_slots(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type CardText__SvelteComponent_ = InstanceType<typeof CardText__SvelteComponent_>;
/*Ωignore_endΩ*/export default CardText__SvelteComponent_;