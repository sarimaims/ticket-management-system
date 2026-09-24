import type { Metadata } from "next";

import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = {
  title: "Dashboard — FlowDesk",
};

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Dashboard" }]}
      />
      <DashboardOverview />
    </>
  );
}
