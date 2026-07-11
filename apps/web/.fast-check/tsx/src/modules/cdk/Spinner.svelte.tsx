///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    color?: string;
    size?: "sm" | "lg" | "";
    class?: string;
    type?: "border" | "grow";
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  

  let {
    color = "",
    size = "",
    class: className = "",
    type = "border",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(
    classnames(
      type === "grow" ? "spinner-grow" : "spinner-border",
      color ? `text-${color}` : "",
      size ? `spinner-border-${size}` : "",
      className
    )
  );
;
async () => {

 { svelteHTML.createElement("div", {    "class":classes,"role":`status`,...rest,});
  ;__sveltets_2_ensureSnippet(children?.());
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Spinner__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Spinner__SvelteComponent_ = ReturnType<typeof Spinner__SvelteComponent_>;
/*Ωignore_endΩ*/export default Spinner__SvelteComponent_;