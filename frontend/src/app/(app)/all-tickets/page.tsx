import { Suspense } from "react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { RequireOverseer } from "@/components/auth/require-overseer";
import { TicketsWorkspace } from "@/components/tickets/tickets-workspace";

export const metadata: Metadata = {
  title: "All Tickets — FlowDesk",
};

/**
 * The whole picture, for the two people who need one: an admin oversees the
 * workspace, a head runs a department. The server decides which of those two
 * a caller is and answers accordingly - this gate only keeps everyone else
 * from landing on a page that would refuse them.
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
