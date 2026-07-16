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

  const base =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 disabled:opacity-50";

  const sizeClass: Record<string, string> = {
    sm: "px-2 py-1 text-xs",
    lg: "px-4 py-3 text-base",
  };

  let inputClass = $derived(
    classnames(
      plaintext ? "bg-transparent border-transparent" : base,
      bsSize ? sizeClass[bsSize] : "",
      className
    )
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
