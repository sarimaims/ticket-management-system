"use client";

import { useState } from "react";

import { PageTitleProvider } from "@/components/layout/page-title";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <PageTitleProvider>
      <div className="min-h-screen">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="flex min-h-screen min-w-0 flex-col lg:pl-60">
          <Topbar onMenu={() => setNavOpen(true)} />
          <main className="min-w-0 flex-1 px-4 py-4 sm:px-6 lg:px-8 lg:py-5">{children}</main>
        </div>
      </div>
    </PageTitleProvider>
  );
}
