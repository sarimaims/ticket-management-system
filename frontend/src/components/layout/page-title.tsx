"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type PageTitleValue = {
  title: string;
  setTitle: (title: string) => void;
};

const PageTitleContext = createContext<PageTitleValue | null>(null);

/**
 * The page name is rendered once, in the topbar. Each page announces its own
 * name through this context, so a data-driven name (a department, say) reaches
 * the topbar without the shell knowing anything about routes.
 */
export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState("");
  const value = useMemo(() => ({ title, setTitle }), [title]);

  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

export function usePageTitle() {
  return useContext(PageTitleContext)?.title ?? "";
}

/** Called by PageHeader; the last page to mount owns the topbar name. */
export function useRegisterPageTitle(title: string) {
  const context = useContext(PageTitleContext);
  const setTitle = context?.setTitle;

  useEffect(() => {
    setTitle?.(title);
  }, [title, setTitle]);
}
