"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useRegisterPage, type Crumb } from "@/components/layout/page-title";

export type { Crumb };

/**
 * A page's identity and its actions, both of which live in the topbar.
 *
 * The name and its trail are published through context; the action buttons are
 * portalled into the bar itself, so no page has a header row of its own and
 * the content starts immediately under one thin bar.
 */
export function PageHeader({
  title,
  crumbs,
  backHref,
  actions,
}: {
  title: string;
  crumbs: Crumb[];
  backHref?: string;
  actions?: React.ReactNode;
}) {
  useRegisterPage({ title, crumbs, backHref });

  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Finding the slot is a DOM read, not derived state: the topbar belongs to
    // the layout above this page and is already mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHost(document.getElementById("page-actions"));
  }, []);

  if (!actions || !host) return null;

  return createPortal(actions, host);
}
