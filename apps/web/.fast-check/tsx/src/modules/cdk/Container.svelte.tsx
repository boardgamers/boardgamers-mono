///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    fluid?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  

  let {
    fluid = false,
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(classnames(fluid ? "container-fluid" : "container", className));
;
async () => {

 { svelteHTML.createElement("div", {  "class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Container__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Container__SvelteComponent_ = ReturnType<typeof Container__SvelteComponent_>;
/*Ωignore_endΩ*/export default Container__SvelteComponent_;