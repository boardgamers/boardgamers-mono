///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    size?: "sm" | "lg" | "";
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  

  let {
    size = "",
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(
    classnames("input-group", size ? `input-group-${size}` : "", className)
  );
;
async () => {

 { svelteHTML.createElement("div", {  "class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const InputGroup__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type InputGroup__SvelteComponent_ = ReturnType<typeof InputGroup__SvelteComponent_>;
/*Ωignore_endΩ*/export default InputGroup__SvelteComponent_;