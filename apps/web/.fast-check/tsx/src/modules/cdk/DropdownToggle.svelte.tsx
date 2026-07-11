///<reference types="svelte" />
;
import { getContext } from "svelte";
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    nav?: boolean;
    caret?: boolean;
    tag?: string;
    color?: string;
    class?: string;
    children?: import("svelte").Snippet;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  };function $$render() {

  
  

  let {
    nav = false,
    caret = true,
    tag = "button",
    color = "",
    class: className = "",
    children,
    onclick,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  const dropdown = getContext<{ isOpen: boolean; toggle: () => void }>("sveltestrap-dropdown");

  function handleClick(e: MouseEvent) {
    onclick?.(e);
    dropdown?.toggle();
  }

  let classes = $derived(
    classnames(
      nav ? "nav-link dropdown-toggle" : "btn",
      nav ? "" : color ? `btn-${color}` : "btn-secondary",
      caret ? "dropdown-toggle" : "",
      className
    )
  );
;
async () => {

if(nav){
   { svelteHTML.createElement("a", {              "href":`#`,"class":classes,"role":`button`,"aria-haspopup":`true`,"aria-expanded":dropdown?.isOpen,"onclick":handleClick,...rest,});
    ;__sveltets_2_ensureSnippet(children?.());
   }
} else if (tag === "div"){
   { svelteHTML.createElement("div", {    "class":classes,"onclick":handleClick,...rest,});
    ;__sveltets_2_ensureSnippet(children?.());
   }
}else{
   { svelteHTML.createElement("button", {          "type":`button`,"class":classes,"aria-haspopup":`true`,"aria-expanded":dropdown?.isOpen,"onclick":handleClick,...rest,});
    ;__sveltets_2_ensureSnippet(children?.());
   }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const DropdownToggle__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type DropdownToggle__SvelteComponent_ = ReturnType<typeof DropdownToggle__SvelteComponent_>;
/*Ωignore_endΩ*/export default DropdownToggle__SvelteComponent_;