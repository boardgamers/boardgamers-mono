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

  let classes = $derived(classnames("row", className));
;
async () => {

 { svelteHTML.createElement("div", {  "class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Row__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Row__SvelteComponent_ = ReturnType<typeof Row__SvelteComponent_>;
/*Ωignore_endΩ*/export default Row__SvelteComponent_;