///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    value?: any;
    type?: string;
    id?: string;
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    autofocus?: boolean;
    bsSize?: "sm" | "lg" | "";
    plaintext?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    onchange?: (e: Event) => void;
    oninput?: (e: Event) => void;
    onblur?: (e: Event) => void;
    onfocus?: (e: Event) => void;
    onkeyup?: (e: KeyboardEvent) => void;
    onkeydown?: (e: KeyboardEvent) => void;
    onmousedown?: (e: MouseEvent) => void;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  };function $$render() {

  

  let {
    value = $bindable(""),
    type = "text",
    id = undefined,
    placeholder = undefined,
    required = false,
    disabled = false,
    autofocus = false,
    bsSize = "",
    plaintext = false,
    class: className = "",
    children,
    onchange,
    oninput,
    onblur,
    onfocus,
    onkeyup,
    onkeydown,
    onmousedown,
    onclick,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props()/*Ωignore_startΩ*/;value;/*Ωignore_endΩ*/;

  let sizeClass = $derived(
    bsSize === "sm" ? "form-control-sm" : bsSize === "lg" ? "form-control-lg" : ""
  );

  let inputClass = $derived(
    classnames(plaintext ? "form-control-plaintext" : "form-control", sizeClass, className)
  );
;
async () => {

if(type === "select"){
   { svelteHTML.createElement("select", {                    "bind:value":value,id,"class":inputClass,required,disabled,"onchange":onchange,"oninput":oninput,"onblur":onblur,"onfocus":onfocus,"onclick":onclick,"onmousedown":onmousedown,...rest,});/*Ωignore_startΩ*/() => value = __sveltets_2_any(null);/*Ωignore_endΩ*/
    ;__sveltets_2_ensureSnippet(children?.());
   }
} else if (type === "textarea"){
   { svelteHTML.createElement("textarea", {                        "bind:value":value,id,placeholder,required,disabled,autofocus,"class":inputClass,"onchange":onchange,"oninput":oninput,"onblur":onblur,"onfocus":onfocus,"onkeyup":onkeyup,"onkeydown":onkeydown,"onclick":onclick,...rest,});/*Ωignore_startΩ*/() => value = __sveltets_2_any(null);/*Ωignore_endΩ*/ }
}else{
   { svelteHTML.createElement("input", {                            "type":type,"bind:value":value,id,placeholder,required,disabled,autofocus,"class":inputClass,"onchange":onchange,"oninput":oninput,"onblur":onblur,"onfocus":onfocus,"onkeyup":onkeyup,"onkeydown":onkeydown,"onclick":onclick,"onmousedown":onmousedown,...rest,});/*Ωignore_startΩ*/() => value = __sveltets_2_any(null);/*Ωignore_endΩ*/}
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings('value'), slots: {}, events: {} }}
const Input__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Input__SvelteComponent_ = ReturnType<typeof Input__SvelteComponent_>;
/*Ωignore_endΩ*/export default Input__SvelteComponent_;