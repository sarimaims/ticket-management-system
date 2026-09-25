import { Suspense } from "react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PeopleWorkspace } from "@/components/admin/people-workspace";

export const metadata: Metadata = {
  title: "Admin Access — FlowDesk",
};

export default function AdminStaffPage() {
  return (
    <>
      <PageHeader
        title="Admin Access"
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Admin Access" }]}
      />
      <Suspense>
        <PeopleWorkspace scope="admins" />
      </Suspense>
    </>
  );
}
