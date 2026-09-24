import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { RequireHead } from "@/components/auth/require-head";
import { TeamWorkspace } from "@/components/team/team-workspace";

export const metadata: Metadata = {
  title: "Users — FlowDesk",
};

export default function TeamPage() {
  return (
    <RequireHead>
      <PageHeader
        title="Users"
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Users" }]}
      />
      <TeamWorkspace />
    </RequireHead>
  );
}
