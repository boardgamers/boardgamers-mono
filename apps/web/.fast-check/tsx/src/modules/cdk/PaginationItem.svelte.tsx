///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    active?: boolean;
    disabled?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  

  let {
    active = false,
    disabled = false,
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(
    classnames("page-item", active ? "active" : "", disabled ? "disabled" : "", className)
  );
;
async () => {

 { svelteHTML.createElement("li", {  "class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const PaginationItem__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type PaginationItem__SvelteComponent_ = ReturnType<typeof PaginationItem__SvelteComponent_>;
/*Ωignore_endΩ*/export default PaginationItem__SvelteComponent_;