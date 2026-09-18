import type { Metadata } from "next";

import { DepartmentsWorkspace } from "@/components/departments/departments-workspace";

export const metadata: Metadata = {
  title: "Departments — FlowDesk",
};

export default function DepartmentsPage() {
  return <DepartmentsWorkspace />;
}
