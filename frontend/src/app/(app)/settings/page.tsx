import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { SettingsForm } from "@/components/settings/settings-form";

export const metadata: Metadata = {
  title: "Settings — AIVIN",
};

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Settings" }]}
      />
      <SettingsForm />
    </>
  );
}
