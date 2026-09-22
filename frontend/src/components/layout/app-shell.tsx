"use client";

import { useState } from "react";

import { NotificationProvider } from "@/components/notifications/notification-provider";
import { PageTitleProvider } from "@/components/layout/page-title";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
      <PageTitleProvider>
      <NotificationProvider>
      <div className="min-h-screen">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="flex min-h-screen min-w-0 flex-col lg:pl-60">
          <Topbar onMenu={() => setNavOpen(true)} />
          <main className="min-w-0 flex-1 px-3 py-3 sm:px-4 lg:px-5 lg:py-4">{children}</main>
        </div>
      </div>
      </NotificationProvider>
      </PageTitleProvider>
  );
}
