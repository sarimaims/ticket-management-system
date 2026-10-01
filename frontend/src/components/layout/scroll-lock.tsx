"use client";

import { useEffect } from "react";

/**
 * What counts as something in front of the page: any modal dialog, and the
 * backdrop of a sheet that has one. A sheet with no backdrop - the ticket
 * sheet on a wide screen, where the list beside it stays in use - leaves the
 * page alone.
 */
const IN_FRONT = '[aria-modal="true"], [data-scroll-lock]';

/** Shown, rather than in the DOM but hidden by a breakpoint. */
const isShown = (element: Element) => element.getClientRects().length > 0;

/**
 * Holds the page still while anything is open in front of it.
 *
 * Scrolling inside a dialog used to carry on into the page behind it once the
 * dialog reached its end - and scrolling over the backdrop moved the page
 * outright - so closing it landed somewhere else. Watched in one place rather
 * than asked of every dialog: any modal, today's or one written later, holds
 * the page while it is open, and none of them can forget to let it go.
 *
 * The scrollbar's width is kept as padding while it is hidden, so the page
 * does not jump sideways when a dialog opens.
 */
export function ScrollLock() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    let locked = false;

    const lock = () => {
      const gap = window.innerWidth - html.clientWidth;
      html.style.overflow = "hidden";
      html.style.overscrollBehavior = "none";
      if (gap > 0) body.style.paddingRight = `${gap}px`;
    };

    const unlock = () => {
      html.style.overflow = "";
      html.style.overscrollBehavior = "";
      body.style.paddingRight = "";
    };

    const check = () => {
      const open = [...document.querySelectorAll(IN_FRONT)].some(isShown);
      if (open === locked) return;
      locked = open;
      if (open) lock();
      else unlock();
    };

    // A dialog arriving, leaving, or a breakpoint showing or hiding a backdrop.
    const observer = new MutationObserver(check);
    observer.observe(body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-modal", "data-scroll-lock"],
    });
    window.addEventListener("resize", check);
    check();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", check);
      unlock();
    };
  }, []);

  return null;
}
