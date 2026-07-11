///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    color?: string;
    dark?: boolean;
    light?: boolean;
    expand?: "" | "sm" | "md" | "lg" | "xl" | boolean;
    fixed?: "" | "top" | "bottom";
    sticky?: "" | "top";
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  

  let {
    color = "",
    dark = false,
    light = false,
    expand = "",
    fixed = "",
    sticky = "",
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let expandClass = $derived(
    expand === true ? "navbar-expand" : expand ? `navbar-expand-${expand}` : ""
  );

  let classes = $derived(
    classnames(
      "navbar",
      dark ? "navbar-dark" : "",
      light ? "navbar-light" : "",
      color ? `bg-${color}` : "",
      expandClass,
      fixed ? `fixed-${fixed}` : "",
      sticky ? `sticky-${sticky}` : "",
      className
    )
  );
;
async () => {

 { svelteHTML.createElement("nav", {  "class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Navbar__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Navbar__SvelteComponent_ = ReturnType<typeof Navbar__SvelteComponent_>;
/*Ωignore_endΩ*/export default Navbar__SvelteComponent_;