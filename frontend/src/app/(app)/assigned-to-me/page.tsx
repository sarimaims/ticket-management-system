import { Suspense } from "react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { TicketsWorkspace } from "@/components/tickets/tickets-workspace";

export const metadata: Metadata = {
  title: "Assigned to Me — FlowDesk",
};

export default function AssignedToMePage() {
  return (
    <>
      <PageHeader
        title="Assigned to Me"
        crumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Tickets", href: "/my-requests" },
          { label: "Assigned to Me" },
        ]}
      />
      {/* A queue other people are filling: it keeps itself current, and reads
          `?ticket=` to find the row a notification meant. */}
      <Suspense>
        <TicketsWorkspace scope="assigned" live />
      </Suspense>
    </>
  );
}
