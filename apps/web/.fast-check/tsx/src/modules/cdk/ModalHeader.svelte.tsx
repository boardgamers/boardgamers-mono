///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    toggle?: () => void;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  

  let {
    toggle = undefined,
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(classnames("modal-header", className));
;
async () => {

 { svelteHTML.createElement("div", {  "class":classes,...rest,});
  ;__sveltets_2_ensureSnippet(children?.());
  if(toggle){
     { svelteHTML.createElement("button", {        "type":`button`,"class":`btn-close`,"aria-label":`Close`,"onclick":toggle,});}
  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ModalHeader__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ModalHeader__SvelteComponent_ = ReturnType<typeof ModalHeader__SvelteComponent_>;
/*Ωignore_endΩ*/export default ModalHeader__SvelteComponent_;