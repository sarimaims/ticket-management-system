import { Suspense } from "react";
import type { Metadata } from "next";

import { AttachmentsLibrary } from "@/components/attachments/attachments-library";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = {
  title: "Attachments — FlowDesk",
};

/**
 * Every photo, video, document and link from the tickets this person can see,
 * searchable in one place. What is readable here is exactly what the tickets
 * themselves are - the API filters it the same way.
 */
export default function AttachmentsPage() {
  return (
    <>
      <PageHeader
        title="Attachments"
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Attachments" }]}
      />
      <Suspense>
        <AttachmentsLibrary />
      </Suspense>
    </>
  );
}
