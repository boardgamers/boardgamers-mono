///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    color?: string;
    outline?: boolean;
    size?: "sm" | "lg" | "";
    block?: boolean;
    disabled?: boolean;
    href?: string;
    type?: "button" | "submit" | "reset";
    class?: string;
    children?: import("svelte").Snippet;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  };function $$render() {

  

  let {
    color = "secondary",
    outline = false,
    size = "",
    block = false,
    disabled = false,
    href,
    type = "button",
    class: className = "",
    children,
    onclick,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(
    classnames(
      "btn",
      outline ? `btn-outline-${color}` : `btn-${color}`,
      size ? `btn-${size}` : "",
      block ? "d-block w-100" : "",
      className
    )
  );

  let tag = $derived(href ? "a" : "button");
;
async () => {

if(tag === "a"){
   { svelteHTML.createElement("a", {        href,"class":classes,"role":`button`,"aria-disabled":disabled,onclick,...rest,});
    ;__sveltets_2_ensureSnippet(children?.());
   }
}else{
   { svelteHTML.createElement("button", {     type,"class":classes,disabled,onclick,...rest,});
    ;__sveltets_2_ensureSnippet(children?.());
   }
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Button__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Button__SvelteComponent_ = ReturnType<typeof Button__SvelteComponent_>;
/*Ωignore_endΩ*/export default Button__SvelteComponent_;