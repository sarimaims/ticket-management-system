"use client";

import { useState } from "react";

import { NotificationProvider } from "@/components/notifications/notification-provider";
import { PageTitleProvider } from "@/components/layout/page-title";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { UserProfileProvider } from "@/components/users/user-profile";
import { SpotlightProvider } from "@/components/search/spotlight";
import { ScrollLock } from "@/components/layout/scroll-lock";
import { ApprovalBanner } from "@/components/tickets/approval-banner";
import { cn } from "@/lib/utils";

/** Whether the desktop sidebar is folded to its icons. Kept per browser. */
const COLLAPSED_KEY = "flowdesk.nav.collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  // The shell mounts only once the session is known (RequireAuth), so reading
  // storage here never disagrees with a server render.
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        if (next) localStorage.setItem(COLLAPSED_KEY, "1");
        else localStorage.removeItem(COLLAPSED_KEY);
      } catch {
        // Folded for this visit only.
      }
      return next;
    });
  };

  return (
      <PageTitleProvider>
      <NotificationProvider>
      {/* One profile card for the whole app: any name, anywhere, opens it. */}
      <UserProfileProvider>
      {/* One search for the whole app: the header box, ⌘K / Ctrl+K, or "/". */}
      <SpotlightProvider>
      {/* The page holds still behind any dialog or covering sheet. */}
      <ScrollLock />
      <div className="min-h-screen">
        <Sidebar
          open={navOpen}
          onClose={() => setNavOpen(false)}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
        <div
          className={cn(
            "flex min-h-screen min-w-0 flex-col transition-[padding] duration-200",
            collapsed ? "lg:pl-14" : "lg:pl-52",
          )}
        >
          <Topbar onMenu={() => setNavOpen(true)} />
          {/* Every page, for as long as a request of theirs waits on them. */}
          <ApprovalBanner />
          <main className="min-w-0 flex-1 px-2.5 py-2.5 sm:px-3 lg:px-4 lg:py-3">{children}</main>
        </div>
      </div>
      </SpotlightProvider>
      </UserProfileProvider>
      </NotificationProvider>
      </PageTitleProvider>
  );
}
