"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Crumb = { label: string; href?: string };

type PageMeta = {
  title: string;
  crumbs: Crumb[];
  backHref?: string;
};

type PageTitleValue = PageMeta & {
  setMeta: (meta: PageMeta) => void;
};

const EMPTY: PageMeta = { title: "", crumbs: [], backHref: undefined };

const PageTitleContext = createContext<PageTitleValue | null>(null);

/**
 * Where the page says what it is.
 *
 * The name and its trail are rendered once, in the topbar, rather than again
 * at the top of every page - one bar instead of two, which is most of what
 * makes a screen feel tall. Each page announces its own through this context,
 * so a data-driven name (a department, say) reaches the topbar without the
 * shell knowing anything about routes.
 */
export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState<PageMeta>(EMPTY);
  const value = useMemo(() => ({ ...meta, setMeta }), [meta]);

  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

export function usePageTitle() {
  return useContext(PageTitleContext)?.title ?? "";
}

/** Everything the topbar draws for the current page. */
export function usePageMeta(): PageMeta {
  const context = useContext(PageTitleContext);
  return context ? { title: context.title, crumbs: context.crumbs, backHref: context.backHref } : EMPTY;
}

/** Called by PageHeader; the last page to mount owns the topbar. */
export function useRegisterPage(meta: PageMeta) {
  const context = useContext(PageTitleContext);
  const setMeta = context?.setMeta;

  // The crumb list is rebuilt on every render, so it is compared by value -
  // otherwise this would loop.
  const fingerprint = JSON.stringify(meta);

  useEffect(() => {
    setMeta?.(JSON.parse(fingerprint) as PageMeta);
  }, [fingerprint, setMeta]);
}
