<script lang="ts">
  import { classnames, browserEvent } from "@/utils";
  import { onDestroy, onMount } from "svelte";
  import type { Snippet } from "svelte";
  import { fade as fadeTransition } from "svelte/transition";

  function noop() {}

  let {
    class: className = "",
    isOpen = false,
    autoFocus = true,
    centered = false,
    backdropDuration = 0,
    scrollable = false,
    size = "",
    toggle = undefined,
    labelledBy = "",
    backdrop = true,
    onEnter = undefined,
    onExit = undefined,
    onOpened = noop,
    onClosed = noop,
    wrapClassName = "",
    modalClassName = "",
    backdropClassName = "",
    contentClassName = "",
    fade = true,
    zIndex = 1050,
    unmountOnClose = true,
    returnFocusAfterClose = true,
    transitionType = fadeTransition,
    transitionOptions = {},
    external,
    children,
    ...rest
  }: {
    class?: string;
    isOpen?: boolean;
    autoFocus?: boolean;
    centered?: boolean;
    backdropDuration?: number;
    scrollable?: boolean;
    size?: string;
    toggle?: (e?: any) => void;
    labelledBy?: string;
    backdrop?: boolean;
    onEnter?: () => void;
    onExit?: () => void;
    onOpened?: () => void;
    onClosed?: () => void;
    wrapClassName?: string;
    modalClassName?: string;
    backdropClassName?: string;
    contentClassName?: string;
    fade?: boolean;
    zIndex?: number;
    unmountOnClose?: boolean;
    returnFocusAfterClose?: boolean;
    transitionType?: any;
    transitionOptions?: Record<string, any>;
    external?: Snippet;
    children?: Snippet;
    [key: string]: any;
  } = $props();

  let hasOpened = $state(false);
  let _isMounted = $state(false);
  let _triggeringElement = $state();
  let _lastIsOpen = $state(isOpen);
  let _lastHasOpened = $state(hasOpened);
  let _dialog = $state();
  let _mouseDownElement = $state();
  let _removeEscListener = $state();

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

  $effect(() => {
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

  let classes = $derived(
    classnames(dialogBaseClass, className, {
      [`modal-${size}`]: size,
      [`${dialogBaseClass}-centered`]: centered,
      [`${dialogBaseClass}-scrollable`]: scrollable,
    })
  );
</script>

{#if _isMounted}
  <div {...rest} class={wrapClassName} tabindex="-1" style="position: relative; z-index: {zIndex}">
    {#if isOpen}
      <div
        transition:transitionType={transitionOptions}
        ariaLabelledby={labelledBy}
        class={classnames("modal", "show", modalClassName)}
        role="dialog"
        style="display: block;"
        onintroend={onModalOpened}
        onoutroend={onModalClosed}
        onclick={handleBackdropClick}
        onmousedown={handleBackdropMouseDown}
      >
        <div class={classes} role="document" bind:this={_dialog}>
          <div class={classnames("modal-content", contentClassName)}>
            {@render external?.()}
            {@render children?.()}
          </div>
        </div>
      </div>
      {#if backdrop}
        <div
          transition:fadeTransition={{ duration: fade && backdropDuration }}
          class={classnames("modal-backdrop", "show", backdropClassName)}
        ></div>
      {/if}
    {/if}
  </div>
{/if}
