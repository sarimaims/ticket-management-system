import { Suspense } from "react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { TicketsWorkspace } from "@/components/tickets/tickets-workspace";

export const metadata: Metadata = {
  title: "My Requests — FlowDesk",
};

export default function MyRequestsPage() {
  return (
    <>
      <PageHeader
        title="My Requests"
        crumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Tickets", href: "/my-requests" },
          { label: "My Requests" },
        ]}
      />
      {/* The workspace reads `?ticket=` to find the row a notification meant. */}
      <Suspense>
        <TicketsWorkspace scope="mine" />
      </Suspense>
    </>
  );
}
