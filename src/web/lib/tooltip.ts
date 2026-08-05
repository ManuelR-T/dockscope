import { hideTooltip, showTooltip, type TooltipContent } from '../stores/tooltip.svelte';

export type TooltipOptions = string | TooltipContent | null | undefined;

/** The bubble's id, so triggers can point `aria-describedby` at it. */
export const TOOLTIP_ID = 'ds-tooltip';

function normalize(options: TooltipOptions): TooltipContent | null {
  if (!options) {
    return null;
  }
  const content = typeof options === 'string' ? { text: options } : options;
  return content.text.trim() ? content : null;
}

/**
 * Attach a tooltip to any element.
 *
 *     <button use:tooltip={'Zoom to fit'}>…
 *     <button use:tooltip={{ text: 'Zoom to fit', shortcut: 'F' }}>…
 *
 * An action rather than a wrapper component: it adds no DOM, so it cannot
 * disturb the flex rows it is used in, and it works on the existing primitives
 * without every one of them having to grow a slot.
 *
 * The element's `title` is removed while the action is attached, so the browser
 * does not draw its own tooltip alongside this one.
 */
export function tooltip(node: HTMLElement, options: TooltipOptions) {
  let content = normalize(options);
  let nativeTitle: string | null = null;
  let open = false;

  function captureTitle() {
    const title = node.getAttribute('title');
    if (title !== null) {
      nativeTitle = title;
      node.removeAttribute('title');
      // Icon-only controls would otherwise lose their accessible name along
      // with the attribute.
      if (!node.getAttribute('aria-label') && !node.textContent?.trim()) {
        node.setAttribute('aria-label', title);
      }
    }
  }

  function restoreTitle() {
    if (nativeTitle !== null) {
      node.setAttribute('title', nativeTitle);
      nativeTitle = null;
    }
  }

  function open_() {
    if (!content) {
      return;
    }
    showTooltip(node, content);
    node.setAttribute('aria-describedby', TOOLTIP_ID);
    open = true;
  }

  function close() {
    if (!open) {
      return;
    }
    hideTooltip();
    node.removeAttribute('aria-describedby');
    open = false;
  }

  function onKeydown(event: KeyboardEvent) {
    // Escape dismisses without moving focus, which is the documented behaviour
    // for a tooltip that is not itself interactive.
    if (event.key === 'Escape') {
      close();
    }
  }

  let listening = false;

  /**
   * Listeners are attached only while there is something to show. Every
   * primitive that accepts a `title` applies this action, including typography
   * ones that usually have none.
   */
  function listen() {
    if (listening) {
      return;
    }
    listening = true;
    // Pointer and keyboard both open it: a control reachable only by tab would
    // otherwise never show its description.
    node.addEventListener('mouseenter', open_);
    node.addEventListener('mouseleave', close);
    node.addEventListener('focus', open_);
    node.addEventListener('blur', close);
    // Acting on a control should not leave its tooltip hanging over the result.
    node.addEventListener('click', close);
    node.addEventListener('keydown', onKeydown);
  }

  function unlisten() {
    if (!listening) {
      return;
    }
    listening = false;
    node.removeEventListener('mouseenter', open_);
    node.removeEventListener('mouseleave', close);
    node.removeEventListener('focus', open_);
    node.removeEventListener('blur', close);
    node.removeEventListener('click', close);
    node.removeEventListener('keydown', onKeydown);
  }

  if (content) {
    captureTitle();
    listen();
  }

  return {
    update(next: TooltipOptions) {
      content = normalize(next);
      if (!content) {
        close();
        unlisten();
        restoreTitle();
        return;
      }
      captureTitle();
      listen();
      if (open) {
        open_();
      }
    },
    destroy() {
      close();
      restoreTitle();
      unlisten();
    },
  };
}
