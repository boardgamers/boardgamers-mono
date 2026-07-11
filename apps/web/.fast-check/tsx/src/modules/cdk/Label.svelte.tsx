///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    for?: string;
    hidden?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  

  let {
    for: forAttr = undefined,
    hidden = false,
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(classnames("form-label", hidden ? "visually-hidden" : "", className));
;
async () => {

 { svelteHTML.createElement("label", {    "for":forAttr,"class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Label__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Label__SvelteComponent_ = ReturnType<typeof Label__SvelteComponent_>;
/*Ωignore_endΩ*/export default Label__SvelteComponent_;