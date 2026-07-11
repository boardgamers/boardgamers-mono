///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    header?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  };function $$render() { let $$slots = __sveltets_2_slotsType({'default': '', 'footer': ''});

  

  let {
    header = "",
    class: className = "",
    onclick,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(classnames("card", className));

/*Ωignore_startΩ*/;const __sveltets_createSlot = __sveltets_2_createCreateSlot();/*Ωignore_endΩ*/;
async () => {

 { svelteHTML.createElement("div", {   "class":classes,onclick,...rest,});
  if(header){
     { svelteHTML.createElement("div", { "class":`card-header`,});header; }
  }
   { svelteHTML.createElement("div", { "class":`card-body`,});
     { __sveltets_createSlot("default", {});}
   }
  if($$slots?.footer){
     { svelteHTML.createElement("div", { "class":`card-footer`,});
       { __sveltets_createSlot("footer", {  });}
     }
  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {'default': {}, 'footer': {}}, events: {} }}
const Card__SvelteComponent_ = __sveltets_2_isomorphic_component_slots(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Card__SvelteComponent_ = InstanceType<typeof Card__SvelteComponent_>;
/*Ωignore_endΩ*/export default Card__SvelteComponent_;