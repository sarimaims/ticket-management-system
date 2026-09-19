import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ActivityLog } from "@/components/activity/activity-log";

export const metadata: Metadata = {
  title: "Activity — FlowDesk",
};

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        title="Activity"
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Activity" }]}
      />
      <ActivityLog />
    </>
  );
}
