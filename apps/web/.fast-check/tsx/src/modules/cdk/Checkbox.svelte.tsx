///<reference types="svelte" />
;
import { classnames } from "@/utils";

;type $$ComponentProps =  {
    checked?: boolean;
    group?: string[] | null;
    value?: string;
    class?: string;
    onchange?: (e: Event) => void;
    onblur?: (e: Event) => void;
    [key: string]: any;
  };function $$render() {

  

  let {
    checked = $bindable(false),
    group = $bindable(null),
    value = "",
    class: className = "",
    onchange,
    onblur,
    ...rest
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props()/*Ωignore_startΩ*/;checked;group;/*Ωignore_endΩ*/;

  // If this checkbox's value is part of the group, mark it checked.
  $effect(() => {
    if (value && group?.includes(value)) {
      checked = true;
    }
  });

  let classes = $derived(classnames(className, "form-check"));

  const id = "check-" + Math.random().toString().slice(2, 9);

  function handleChange(e: Event) {
    const target = e.target as HTMLInputElement;
    checked = target.checked;

    if (group && value) {
      if (checked && !group.includes(value)) {
        group = [...group, value];
      } else if (!checked && group.includes(value)) {
        group = group.filter((x) => x !== value);
      }
    }

    onchange?.(e);
  }

/*Ωignore_startΩ*/;const __sveltets_createSlot = __sveltets_2_createCreateSlot();/*Ωignore_endΩ*/;
async () => {

 { svelteHTML.createElement("div", { "class":classes,});
   { svelteHTML.createElement("input", {             "type":`checkbox`,"class":`form-check-input`,id,"bind:checked":checked,value,"onchange":handleChange,"onblur":onblur,...rest,});/*Ωignore_startΩ*/() => checked = __sveltets_2_any(null);/*Ωignore_endΩ*/}
   { svelteHTML.createElement("label", {     "class":`form-check-label`,"for":id,"style":`cursor: pointer`,}); { __sveltets_createSlot("default", {});} }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings('checked', 'group'), slots: {'default': {}}, events: {} }}
const Checkbox__SvelteComponent_ = __sveltets_2_isomorphic_component_slots(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Checkbox__SvelteComponent_ = InstanceType<typeof Checkbox__SvelteComponent_>;
/*Ωignore_endΩ*/export default Checkbox__SvelteComponent_;