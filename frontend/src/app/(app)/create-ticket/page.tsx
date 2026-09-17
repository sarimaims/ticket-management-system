import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { TicketForm } from "@/components/tickets/ticket-form";

export const metadata: Metadata = {
  title: "Create Ticket — AIVIN",
};

export default function CreateTicketPage() {
  return (
    <>
      <PageHeader
        title="Create New Ticket"
        backHref="/my-requests"
        crumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Tickets", href: "/my-requests" },
          { label: "Create Ticket" },
        ]}
      />
      <TicketForm />
    </>
  );
}
