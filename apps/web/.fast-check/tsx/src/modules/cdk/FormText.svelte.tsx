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

  let classes = $derived(classnames("form-text", className));
;
async () => {

 { svelteHTML.createElement("small", {  "class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const FormText__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type FormText__SvelteComponent_ = ReturnType<typeof FormText__SvelteComponent_>;
/*Ωignore_endΩ*/export default FormText__SvelteComponent_;