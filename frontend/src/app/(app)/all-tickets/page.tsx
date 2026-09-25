import { Suspense } from "react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { RequireOverseer } from "@/components/auth/require-overseer";
import { TicketsWorkspace } from "@/components/tickets/tickets-workspace";

export const metadata: Metadata = {
  title: "All Tickets — FlowDesk",
};

/**
 * Every ticket in reach: for an admin that is the workspace, for everyone else
 * it is the queues of the departments they belong to - their own assignments
 * included. The narrower "just mine" question is what Assigned to Me answers.
 *
 * A plain user has no queue to oversee - what is theirs is under Assigned to
 * Me and My Requests - so the page is for admins and heads only.
 */
export default function AllTicketsPage() {
  return (
    <RequireOverseer>
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
    </RequireOverseer>
  );
}
