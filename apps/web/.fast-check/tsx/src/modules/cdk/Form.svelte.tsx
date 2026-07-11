///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    class?: string;
    children?: import("svelte").Snippet;
    onsubmit?: (e: SubmitEvent) => void;
    [key: string]: any;
  };function $$render() {

  

  let {
    class: className = "",
    children,
    onsubmit,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(classnames(className));
;
async () => {

 { svelteHTML.createElement("form", {    "class":classes,"onsubmit":onsubmit,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Form__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Form__SvelteComponent_ = ReturnType<typeof Form__SvelteComponent_>;
/*Ωignore_endΩ*/export default Form__SvelteComponent_;