import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { SettingsForm } from "@/components/settings/settings-form";

export const metadata: Metadata = {
  title: "Profile — FlowDesk",
};

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Profile"
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Profile" }]}
      />
      <SettingsForm />
    </>
  );
}
