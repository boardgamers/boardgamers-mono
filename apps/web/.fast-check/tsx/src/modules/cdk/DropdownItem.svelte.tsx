///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    href?: string;
    disabled?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  };function $$render() {

  

  let {
    href = "#",
    disabled = false,
    class: className = "",
    children,
    onclick,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(classnames("dropdown-item", disabled ? "disabled" : "", className));

  function handleClick(e: MouseEvent) {
    if (disabled) {
      e.preventDefault();
      return;
    }
    onclick?.(e);
  }
;
async () => {

 { svelteHTML.createElement("a", {       href,"class":classes,"aria-disabled":disabled || undefined,"onclick":handleClick,...rest,});
  ;__sveltets_2_ensureSnippet(children?.());
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const DropdownItem__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type DropdownItem__SvelteComponent_ = ReturnType<typeof DropdownItem__SvelteComponent_>;
/*Ωignore_endΩ*/export default DropdownItem__SvelteComponent_;