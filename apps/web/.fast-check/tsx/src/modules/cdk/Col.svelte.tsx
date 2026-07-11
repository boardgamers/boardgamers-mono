///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    xs?: string | number;
    sm?: string | number;
    md?: string | number;
    lg?: string | number;
    xl?: string | number;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  

  let {
    xs = "",
    sm = "",
    md = "",
    lg = "",
    xl = "",
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  function colClass(prefix: string, value: string | number): string {
    if (value === "" || value === undefined || value === null) return "";
    if (value === true || value === "true") return `col-${prefix}`;
    return `col-${prefix}-${value}`;
  }

  let classes = $derived(
    classnames(
      "col",
      colClass("", xs),
      colClass("sm", sm),
      colClass("md", md),
      colClass("lg", lg),
      colClass("xl", xl),
      className
    )
  );
;
async () => {

 { svelteHTML.createElement("div", {  "class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Col__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Col__SvelteComponent_ = ReturnType<typeof Col__SvelteComponent_>;
/*Ωignore_endΩ*/export default Col__SvelteComponent_;