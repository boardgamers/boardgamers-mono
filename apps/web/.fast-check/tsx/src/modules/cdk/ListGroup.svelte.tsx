///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    flush?: boolean;
    horizontal?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  

  let {
    flush = false,
    horizontal = false,
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(
    classnames(
      "list-group",
      flush ? "list-group-flush" : "",
      horizontal ? "list-group-horizontal" : "",
      className
    )
  );
;
async () => {

 { svelteHTML.createElement("ul", {  "class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ListGroup__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ListGroup__SvelteComponent_ = ReturnType<typeof ListGroup__SvelteComponent_>;
/*Ωignore_endΩ*/export default ListGroup__SvelteComponent_;