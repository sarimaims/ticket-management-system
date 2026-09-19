import type { Metadata } from "next";

import { UnitDetail } from "@/components/units/unit-detail";

export const metadata: Metadata = {
  title: "Unit — FlowDesk",
};

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <UnitDetail unitId={id} />;
}
