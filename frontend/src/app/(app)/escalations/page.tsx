import { Suspense } from "react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { RequireSuperAdmin } from "@/components/auth/require-super-admin";
import { TicketsWorkspace } from "@/components/tickets/tickets-workspace";

export const metadata: Metadata = {
  title: "Escalations — FlowDesk",
};

/**
 * Every ticket somebody has put in front of the super admin, with the reason
 * they gave. It opens on the ones still waiting; the handled ones are a tile
 * away. The super admin's alone - the API refuses the list to anyone else.
 */
export default function EscalationsPage() {
  return (
    <RequireSuperAdmin>
      <PageHeader
        title="Escalations"
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Escalations" }]}
      />
      {/* Live: an escalation is somebody waiting on the person reading this. */}
      <Suspense>
        <TicketsWorkspace scope="escalated" live />
      </Suspense>
    </RequireSuperAdmin>
  );
}
