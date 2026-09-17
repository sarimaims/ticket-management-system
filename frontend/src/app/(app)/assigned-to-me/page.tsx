import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { TicketsWorkspace } from "@/components/tickets/tickets-workspace";

export const metadata: Metadata = {
  title: "Assigned to Me — AIVIN",
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
      <TicketsWorkspace scope="assigned" />
    </>
  );
}
