<script lang="ts">
  import { classnames } from "@/utils";

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
  }: {
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
  } = $props();

  let sizeClass = $derived(
    bsSize === "sm" ? "form-control-sm" : bsSize === "lg" ? "form-control-lg" : ""
  );

  let inputClass = $derived(
    classnames(plaintext ? "form-control-plaintext" : "form-control", sizeClass, className)
  );
</script>

{#if type === "select"}
  <select
    bind:value
    {id}
    class={inputClass}
    {required}
    {disabled}
    onchange={onchange}
    oninput={oninput}
    onblur={onblur}
    onfocus={onfocus}
    onclick={onclick}
    onmousedown={onmousedown}
    {...rest}
  >
    {@render children?.()}
  </select>
{:else if type === "textarea"}
  <textarea
    bind:value
    {id}
    {placeholder}
    {required}
    {disabled}
    {autofocus}
    class={inputClass}
    onchange={onchange}
    oninput={oninput}
    onblur={onblur}
    onfocus={onfocus}
    onkeyup={onkeyup}
    onkeydown={onkeydown}
    onclick={onclick}
    {...rest}
  ></textarea>
{:else}
  <input
    type={type}
    bind:value
    {id}
    {placeholder}
    {required}
    {disabled}
    {autofocus}
    class={inputClass}
    onchange={onchange}
    oninput={oninput}
    onblur={onblur}
    onfocus={onfocus}
    onkeyup={onkeyup}
    onkeydown={onkeydown}
    onclick={onclick}
    onmousedown={onmousedown}
    {...rest}
  />
{/if}
