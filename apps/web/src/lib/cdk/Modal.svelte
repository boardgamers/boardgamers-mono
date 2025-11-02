<script lang="ts">
  import { classnames } from "$lib/utils/classname";
  import { onDestroy, onMount } from "svelte";
  import { fade as fadeTransition } from "svelte/transition";
  import { iso } from "zod";

  function noop() {}

  let className = "";
  export { className as class };
  export let isOpen = false;
  export let autoFocus = true;
  export let centered = false;
  export let backdropDuration = 0;
  export let scrollable = false;
  export let size = "";
  export let toggle: (event?: KeyboardEvent | MouseEvent) => void;
  export let labelledBy = "";
  export let backdrop = true;
  export let onEnter: () => void = noop;
  export let onExit: () => void = noop;
  export let onOpened = noop;
  export let onClosed = noop;
  export let wrapClassName = "";
  export let modalClassName = "";
  export let backdropClassName = "";
  export let contentClassName = "";
  export let fade = true;
  export let zIndex = 1050;
  export let unmountOnClose = true;
  export let returnFocusAfterClose = true;
  export let transitionType = fadeTransition;
  export let transitionOptions = {};

  let hasOpened = false;
  let _isMounted = false;
  let _triggeringElement: Element | null = null;
  let _lastIsOpen = isOpen;
  let _lastHasOpened = hasOpened;
  let _dialog: HTMLElement | null = null;
  let _mouseDownElement: HTMLElement | null = null;
  let _removeEscListener: () => void = noop;

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
    if (_dialog && _dialog.parentNode && "focus" in _dialog.parentNode && typeof _dialog.parentNode.focus === "function") {
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
      if ("focus" in _triggeringElement && typeof _triggeringElement.focus === "function" && returnFocusAfterClose) {
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
    onOpened();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (isOpen && event.key && event.key === "Escape") {
      toggle(event);
    }
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

  $: classes = classnames(dialogBaseClass, className, {
    [`modal-${size}`]: size,
    [`${dialogBaseClass}-centered`]: centered,
    [`${dialogBaseClass}-scrollable`]: scrollable,
  });
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if _isMounted}
  <div {...$$restProps} class={wrapClassName} tabindex="-1" style="position: relative; z-index: {zIndex}">
    {#if isOpen}
      <div
        transition:transitionType={transitionOptions}
        aria-labelledby={labelledBy}
        class={classnames("modal", "show", modalClassName)}
        role="dialog"
        style="display: block;"
        on:introend={onOpened}
        on:outroend={onModalClosed}
        on:click={handleBackdropClick}
        on:mousedown={handleBackdropMouseDown}
      >
        <div class={classes} role="document" bind:this={_dialog}>
          <div class={classnames("modal-content", contentClassName)}>
            <slot name="external" />
            <slot />
          </div>
        </div>
      </div>
      {#if backdrop}
        <div
          transition:fadeTransition={{ duration: fade && backdropDuration }}
          class={classnames("modal-backdrop", "show", backdropClassName)}
        />
      {/if}
    {/if}
  </div>
{/if}
