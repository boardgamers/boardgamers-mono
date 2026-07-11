///<reference types="svelte" />
;
import { setContext } from "svelte";
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    isOpen?: boolean;
    toggle?: () => void;
    inNavbar?: boolean;
    group?: boolean;
    nav?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  
  

  let {
    isOpen = undefined,
    toggle = undefined,
    inNavbar = false,
    group = false,
    nav = false,
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  // Internal state for uncontrolled usage (no isOpen prop passed).
  let internalOpen = $state(false);
  let open = $derived(isOpen !== undefined ? isOpen : internalOpen);

  function doToggle() {
    if (toggle) {
      toggle();
    } else {
      internalOpen = !internalOpen;
    }
  }

  // Share reactive state with DropdownToggle / DropdownMenu via context.
  // The getter makes `isOpen` reactive when read inside a child template.
  setContext("sveltestrap-dropdown", {
    get isOpen() {
      return open;
    },
    toggle: doToggle,
  });

  let classes = $derived(
    classnames(
      group ? "btn-group" : "dropdown",
      nav ? "nav-item dropdown" : "",
      open ? "show" : "",
      className
    )
  );
;
async () => {

 { svelteHTML.createElement("div", {  "class":classes,...rest,});
  ;__sveltets_2_ensureSnippet(children?.());
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Dropdown__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Dropdown__SvelteComponent_ = ReturnType<typeof Dropdown__SvelteComponent_>;
/*Ωignore_endΩ*/export default Dropdown__SvelteComponent_;