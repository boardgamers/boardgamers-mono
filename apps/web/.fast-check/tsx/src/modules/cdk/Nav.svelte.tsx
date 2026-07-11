///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    pills?: boolean;
    tabs?: boolean;
    vertical?: boolean;
    navbar?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  

  let {
    pills = false,
    tabs = false,
    vertical = false,
    navbar = false,
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(
    classnames(
      navbar ? "navbar-nav" : "nav",
      pills ? "nav-pills" : "",
      tabs ? "nav-tabs" : "",
      vertical ? "flex-column" : "",
      className
    )
  );
;
async () => {

 { svelteHTML.createElement("ul", {  "class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Nav__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Nav__SvelteComponent_ = ReturnType<typeof Nav__SvelteComponent_>;
/*Ωignore_endΩ*/export default Nav__SvelteComponent_;