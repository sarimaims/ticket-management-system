import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { TicketsWorkspace } from "@/components/tickets/tickets-workspace";

export const metadata: Metadata = {
  title: "My Requests — AIVIN",
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
      <TicketsWorkspace scope="mine" />
    </>
  );
}
