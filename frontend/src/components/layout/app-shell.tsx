"use client";

import { useState } from "react";

import { NotificationProvider } from "@/components/notifications/notification-provider";
import { PageTitleProvider } from "@/components/layout/page-title";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { UserProfileProvider } from "@/components/users/user-profile";
import { ApprovalBanner } from "@/components/tickets/approval-banner";
import { QuickTodoButton } from "@/components/todos/quick-todo-button";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
      <PageTitleProvider>
      <NotificationProvider>
      {/* One profile card for the whole app: any name, anywhere, opens it. */}
      <UserProfileProvider>
      <div className="min-h-screen">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="flex min-h-screen min-w-0 flex-col lg:pl-52">
          <Topbar onMenu={() => setNavOpen(true)} />
          {/* Every page, for as long as a request of theirs waits on them. */}
          <ApprovalBanner />
          <main className="min-w-0 flex-1 px-2.5 py-2.5 sm:px-3 lg:px-4 lg:py-3">{children}</main>
        </div>
        {/* A to-do is one click away from every page. */}
        <QuickTodoButton />
      </div>
      </UserProfileProvider>
      </NotificationProvider>
      </PageTitleProvider>
  );
}
