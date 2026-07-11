///<reference types="svelte" />
;
  import { tick } from "svelte";

  /**
   * Usage: <div use:portal={'css selector'}> or <div use:portal={document.body}>
   *
   * @param {HTMLElement} el
   * @param {HTMLElement|string} target DOM Element or CSS Selector
   */
  export function portal(el, target = "body") {
    let targetEl;
    async function update(newTarget) {
      target = newTarget;
      if (typeof target === "string") {
        targetEl = document.querySelector(target);
        if (targetEl === null) {
          await tick();
          targetEl = document.querySelector(target);
        }
        if (targetEl === null) {
          throw new Error(`No element found matching css selector: "${target}"`);
        }
      } else if (target instanceof HTMLElement) {
        targetEl = target;
      } else {
        throw new TypeError(
          `Unknown portal target type: ${
            target === null ? "null" : typeof target
          }. Allowed types: string (CSS selector) or HTMLElement.`
        );
      }
      targetEl.appendChild(el);
      el.hidden = false;
    }

    function destroy() {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }

    update(target);
    return {
      update,
      destroy,
    };
  }
;;function $$render() {

  /**
   * DOM Element or CSS Selector
   * @type { HTMLElement|string}
   */
   let target = "body"/*Ωignore_startΩ*/;target = __sveltets_2_any(target);/*Ωignore_endΩ*/;

/*Ωignore_startΩ*/;const __sveltets_createSlot = __sveltets_2_createCreateSlot();/*Ωignore_endΩ*/;
async () => {



 {const $$action_0 = __sveltets_2_ensureAction(portal(svelteHTML.mapElementTag('div'),(target)));{ svelteHTML.createElement("div", __sveltets_2_union($$action_0), {   "hidden":true,});
   { __sveltets_createSlot("default", {});}
 }}
};
return { props: {
/**
   * DOM Element or CSS Selector
   * @type { HTMLElement|string}
   */target: target}, exports: {}, bindings: "", slots: {'default': {}}, events: {} }}
const Portal__SvelteComponent_ = __sveltets_2_isomorphic_component_slots(__sveltets_2_partial(['target'], __sveltets_2_with_any_event($$render())));
/*Ωignore_startΩ*/type Portal__SvelteComponent_ = InstanceType<typeof Portal__SvelteComponent_>;
/*Ωignore_endΩ*/export default Portal__SvelteComponent_;