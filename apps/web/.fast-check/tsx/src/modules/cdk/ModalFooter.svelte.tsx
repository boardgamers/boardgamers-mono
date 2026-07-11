///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  

  let {
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(classnames("modal-footer", className));
;
async () => {

 { svelteHTML.createElement("div", {  "class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ModalFooter__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ModalFooter__SvelteComponent_ = ReturnType<typeof ModalFooter__SvelteComponent_>;
/*Ωignore_endΩ*/export default ModalFooter__SvelteComponent_;