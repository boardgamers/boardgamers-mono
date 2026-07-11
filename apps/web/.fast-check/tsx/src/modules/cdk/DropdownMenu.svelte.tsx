///<reference types="svelte" />
;
import { getContext } from "svelte";
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    right?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  
  

  let {
    right = false,
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  const dropdown = getContext<{ isOpen: boolean; toggle: () => void }>("sveltestrap-dropdown");

  let classes = $derived(
    classnames("dropdown-menu", dropdown?.isOpen ? "show" : "", right ? "dropdown-menu-end" : "", className)
  );
;
async () => {

 { svelteHTML.createElement("div", {  "class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const DropdownMenu__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type DropdownMenu__SvelteComponent_ = ReturnType<typeof DropdownMenu__SvelteComponent_>;
/*Ωignore_endΩ*/export default DropdownMenu__SvelteComponent_;