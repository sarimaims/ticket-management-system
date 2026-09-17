import type { Metadata } from "next";

import { DepartmentDetail } from "@/components/departments/department-detail";

export const metadata: Metadata = {
  title: "Department — AIVIN",
};

export default async function DepartmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <DepartmentDetail departmentId={id} />;
}
