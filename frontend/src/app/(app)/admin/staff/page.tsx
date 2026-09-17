import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PeopleWorkspace } from "@/components/admin/people-workspace";

export const metadata: Metadata = {
  title: "Staff — AIVIN",
};

export default function AdminStaffPage() {
  return (
    <>
      <PageHeader
        title="Staff"
        crumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Administration" },
          { label: "Staff" },
        ]}
      />
      <PeopleWorkspace scope="admins" />
    </>
  );
}
