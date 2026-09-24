import { Suspense } from "react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { TicketsWorkspace } from "@/components/tickets/tickets-workspace";

export const metadata: Metadata = {
  title: "All Tickets — FlowDesk",
};

/**
 * Every ticket in reach: for an admin that is the workspace, for everyone else
 * it is the queues of the departments they belong to - their own assignments
 * included. The narrower "just mine" question is what Assigned to Me answers.
 *
 * The server decides which of those a caller is and answers accordingly, so
 * there is no gate here.
 */
export default function AllTicketsPage() {
  return (
    <>
      <PageHeader
        title="All Tickets"
        crumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Tickets", href: "/my-requests" },
          { label: "All Tickets" },
        ]}
      />
      {/* Live, because this is the view somebody watches while a queue moves. */}
      <Suspense>
        <TicketsWorkspace scope="all" live />
      </Suspense>
    </>
  );
}
