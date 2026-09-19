import type { Metadata } from "next";

import { UnitsWorkspace } from "@/components/units/units-workspace";

export const metadata: Metadata = {
  title: "Units — FlowDesk",
};

export default function UnitsPage() {
  return <UnitsWorkspace />;
}
