import { Suspense } from "react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PeopleWorkspace } from "@/components/admin/people-workspace";

export const metadata: Metadata = {
  title: "Users — FlowDesk",
};

export default function AdminUsersPage() {
  return (
    <>
      <PageHeader
        title="Users"
        crumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Administration" },
          { label: "Users" },
        ]}
      />
      <Suspense>
        <PeopleWorkspace scope="all" />
      </Suspense>
    </>
  );
}
