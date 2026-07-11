///<reference types="svelte" />
;
import { classnames, browserEvent } from "@/utils";
import { onDestroy, onMount, afterUpdate } from "svelte";
import { fade as fadeTransition } from "svelte/transition";
function $$render() { let $$restProps = __sveltets_2_restPropsType();

  
  
  

  function noop() {}

  let className = "";
  
   let isOpen = false/*Ωignore_startΩ*/;isOpen = __sveltets_2_any(isOpen);/*Ωignore_endΩ*/;
   let autoFocus = true/*Ωignore_startΩ*/;autoFocus = __sveltets_2_any(autoFocus);/*Ωignore_endΩ*/;
   let centered = false/*Ωignore_startΩ*/;centered = __sveltets_2_any(centered);/*Ωignore_endΩ*/;
   let backdropDuration = 0;
   let scrollable = false/*Ωignore_startΩ*/;scrollable = __sveltets_2_any(scrollable);/*Ωignore_endΩ*/;
   let size = "";
   let toggle: () => void/*Ωignore_startΩ*/;toggle = __sveltets_2_any(toggle);/*Ωignore_endΩ*/;
   let labelledBy = "";
   let backdrop = true/*Ωignore_startΩ*/;backdrop = __sveltets_2_any(backdrop);/*Ωignore_endΩ*/;
   let onEnter = undefined;
   let onExit = undefined;
   let onOpened = noop;
   let onClosed = noop;
   let wrapClassName = "";
   let modalClassName = "";
   let backdropClassName = "";
   let contentClassName = "";
   let fade = true/*Ωignore_startΩ*/;fade = __sveltets_2_any(fade);/*Ωignore_endΩ*/;
   let zIndex = 1050;
   let unmountOnClose = true/*Ωignore_startΩ*/;unmountOnClose = __sveltets_2_any(unmountOnClose);/*Ωignore_endΩ*/;
   let returnFocusAfterClose = true/*Ωignore_startΩ*/;returnFocusAfterClose = __sveltets_2_any(returnFocusAfterClose);/*Ωignore_endΩ*/;
   let transitionType = fadeTransition;
   let transitionOptions = {};

  let hasOpened = false;
  let _isMounted = false;
  let _triggeringElement;
  let _lastIsOpen = isOpen;
  let _lastHasOpened = hasOpened;
  let _dialog;
  let _mouseDownElement;
  let _removeEscListener;

  onMount(() => {
    if (isOpen) {
      init();
      hasOpened = true;
    }

    if (typeof onEnter === "function") {
      onEnter();
    }

    if (hasOpened && autoFocus) {
      setFocus();
    }
  });

  onDestroy(() => {
    if (typeof onExit === "function") {
      onExit();
    }

    destroy();
    if (hasOpened) {
      close();
    }
  });

  afterUpdate(() => {
    if (isOpen && !_lastIsOpen) {
      init();
      hasOpened = true;
    }

    if (autoFocus && hasOpened && !_lastHasOpened) {
      setFocus();
    }

    _lastIsOpen = isOpen;
    _lastHasOpened = hasOpened;
  });

  function setFocus() {
    if (_dialog && _dialog.parentNode && typeof _dialog.parentNode.focus === "function") {
      _dialog.parentNode.focus();
    }
  }

  function init() {
    try {
      _triggeringElement = document.activeElement;
    } catch (err) {
      _triggeringElement = null;
    }

    _isMounted = true;
  }

  function manageFocusAfterClose() {
    if (_triggeringElement) {
      if (typeof _triggeringElement.focus === "function" && returnFocusAfterClose) {
        _triggeringElement.focus();
      }

      _triggeringElement = null;
    }
  }

  function destroy() {
    manageFocusAfterClose();
  }

  function close() {
    manageFocusAfterClose();
  }

  function handleBackdropClick(e) {
    if (e.target === _mouseDownElement) {
      e.stopPropagation();
      if (!isOpen || !backdrop) {
        return;
      }

      const backdropElem = _dialog ? _dialog.parentNode : null;
      if (backdropElem && e.target === backdropElem && toggle) {
        toggle(e);
      }
    }
  }

  function onModalOpened() {
    _removeEscListener = browserEvent(document, "keydown", (event) => {
      if (event.key && event.key === "Escape") {
        toggle(event);
      }
    });

    onOpened();
  }

  function onModalClosed() {
    onClosed();

    if (_removeEscListener) {
      _removeEscListener();
    }

    if (unmountOnClose) {
      destroy();
    }
    close();
    if (_isMounted) {
      hasOpened = false;
    }
    _isMounted = false;
  }

  function handleBackdropMouseDown(e) {
    _mouseDownElement = e.target;
  }

  const dialogBaseClass = "modal-dialog";

  let  classes = __sveltets_2_invalidate(() => classnames(dialogBaseClass, className, {
    [`modal-${size}`]: size,
    [`${dialogBaseClass}-centered`]: centered,
    [`${dialogBaseClass}-scrollable`]: scrollable,
  }));

/*Ωignore_startΩ*/;const __sveltets_createSlot = __sveltets_2_createCreateSlot();/*Ωignore_endΩ*/;
async () => {

if(_isMounted){
   { svelteHTML.createElement("div", {      ...$$restProps,"class":wrapClassName,"tabindex":-1,"style":`position: relative; z-index: ${zIndex}`,});
    if(isOpen){
       { svelteHTML.createElement("div", {                   "arialabelledby":labelledBy,"class":classnames("modal", "show", modalClassName),"role":`dialog`,"style":`display: block;`,"on:introend":onModalOpened,"on:outroend":onModalClosed,"on:click":handleBackdropClick,"on:mousedown":handleBackdropMouseDown,});__sveltets_2_ensureTransition(transitionType(svelteHTML.mapElementTag('div'),(transitionOptions)));
         { const $$_div2 = svelteHTML.createElement("div", {    "class":classes,"role":`document`,});_dialog = $$_div2;
           { svelteHTML.createElement("div", { "class":classnames("modal-content", contentClassName),});
             { __sveltets_createSlot("external", {  });}
             { __sveltets_createSlot("default", {});}
           }
         }
       }
      if(backdrop){
         { svelteHTML.createElement("div", {     "class":classnames("modal-backdrop", "show", backdropClassName),});__sveltets_2_ensureTransition(fadeTransition(svelteHTML.mapElementTag('div'),({ duration: fade && backdropDuration })));}
      }
    }
   }
}
};
return { props: {class: className , isOpen: isOpen , autoFocus: autoFocus , centered: centered , backdropDuration: backdropDuration , scrollable: scrollable , size: size , toggle: toggle , labelledBy: labelledBy , backdrop: backdrop , onEnter: onEnter , onExit: onExit , onOpened: onOpened , onClosed: onClosed , wrapClassName: wrapClassName , modalClassName: modalClassName , backdropClassName: backdropClassName , contentClassName: contentClassName , fade: fade , zIndex: zIndex , unmountOnClose: unmountOnClose , returnFocusAfterClose: returnFocusAfterClose , transitionType: transitionType , transitionOptions: transitionOptions} as {class?: typeof className, isOpen?: typeof isOpen, autoFocus?: typeof autoFocus, centered?: typeof centered, backdropDuration?: typeof backdropDuration, scrollable?: typeof scrollable, size?: typeof size, toggle: () => void, labelledBy?: typeof labelledBy, backdrop?: typeof backdrop, onEnter?: typeof onEnter, onExit?: typeof onExit, onOpened?: typeof onOpened, onClosed?: typeof onClosed, wrapClassName?: typeof wrapClassName, modalClassName?: typeof modalClassName, backdropClassName?: typeof backdropClassName, contentClassName?: typeof contentClassName, fade?: typeof fade, zIndex?: typeof zIndex, unmountOnClose?: typeof unmountOnClose, returnFocusAfterClose?: typeof returnFocusAfterClose, transitionType?: typeof transitionType, transitionOptions?: typeof transitionOptions}, exports: {}, bindings: "", slots: {'external': {}, 'default': {}}, events: {} }}
const Modal__SvelteComponent_ = __sveltets_2_isomorphic_component_slots(__sveltets_2_with_any(__sveltets_2_with_any_event($$render())));
/*Ωignore_startΩ*/type Modal__SvelteComponent_ = InstanceType<typeof Modal__SvelteComponent_>;
/*Ωignore_endΩ*/export default Modal__SvelteComponent_;