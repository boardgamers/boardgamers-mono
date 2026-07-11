///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    active?: boolean;
    disabled?: boolean;
    href?: string;
    class?: string;
    children?: import("svelte").Snippet;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  };function $$render() {

  

  let {
    active = false,
    disabled = false,
    href = "#",
    class: className = "",
    children,
    onclick,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(
    classnames("nav-link", active ? "active" : "", disabled ? "disabled" : "", className)
  );
;
async () => {

 { svelteHTML.createElement("a", {      href,"class":classes,"aria-disabled":disabled || undefined,onclick,...rest,});
  ;__sveltets_2_ensureSnippet(children?.());
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const NavLink__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type NavLink__SvelteComponent_ = ReturnType<typeof NavLink__SvelteComponent_>;
/*Ωignore_endΩ*/export default NavLink__SvelteComponent_;