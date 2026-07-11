///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    color?: string;
    pill?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  };function $$render() {

  

  let {
    color = "secondary",
    pill = false,
    class: className = "",
    children,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  let classes = $derived(
    classnames("badge", `bg-${color}`, pill ? "rounded-pill" : "", className)
  );
;
async () => {

 { svelteHTML.createElement("span", {  "class":classes,...rest,});;__sveltets_2_ensureSnippet(children?.()); }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Badge__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Badge__SvelteComponent_ = ReturnType<typeof Badge__SvelteComponent_>;
/*Ωignore_endΩ*/export default Badge__SvelteComponent_;