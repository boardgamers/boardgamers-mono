///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    href?: string;
    first?: boolean;
    previous?: boolean;
    next?: boolean;
    last?: boolean;
    arialabel?: string;
    class?: string;
    children?: import("svelte").Snippet;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  };function $$render() {

  

  let {
    href = "#",
    first = false,
    previous = false,
    next = false,
    last = false,
    arialabel = undefined,
    class: className = "",
    children,
    onclick,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(classnames("page-link", className));

  // Bootstrap pagination uses these glyphs for first/prev/next/last.
  let defaultContent = $derived(
    first ? "«" : previous ? "‹" : next ? "›" : last ? "»" : undefined
  );
;
async () => {

  { svelteHTML.createElement("a", {       href,"class":classes,"aria-label":arialabel,onclick,...rest,});
  ;__sveltets_2_ensureSnippet(children?.());
  if(defaultContent !== undefined && !children){defaultContent;}
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const PaginationLink__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type PaginationLink__SvelteComponent_ = ReturnType<typeof PaginationLink__SvelteComponent_>;
/*Ωignore_endΩ*/export default PaginationLink__SvelteComponent_;