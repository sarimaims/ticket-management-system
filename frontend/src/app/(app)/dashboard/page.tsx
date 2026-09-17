import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { StatTiles } from "@/components/ui/stat-tiles";
import { VolumeChart } from "@/components/dashboard/volume-chart";
import { DepartmentChart } from "@/components/dashboard/department-chart";
import { StatusShare } from "@/components/dashboard/status-share";
import { DASHBOARD_STATS, RECENT_ACTIVITY } from "@/lib/dashboard-data";

export const metadata: Metadata = {
  title: "Dashboard — AIVIN",
};

const ACTIVITY_DOT: Record<string, string> = {
  new: "bg-status-new-fg",
  waiting: "bg-status-waiting-fg",
  completed: "bg-status-completed-fg",
  overdue: "bg-status-overdue-fg",
};

function CardHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-1">
      <h2 className="text-base font-bold text-ink-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Dashboard" }]}
      />

      <StatTiles stats={DASHBOARD_STATS} />

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <CardHeading title="Ticket Volume" subtitle="Created against resolved, per month" />
          <VolumeChart />
        </Card>

        <Card className="p-5">
          <CardHeading title="Requests by Status" subtitle="Share of all 46 tickets" />
          <div className="mt-5">
            <StatusShare />
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <CardHeading title="Requests by Department" subtitle="Tickets received, this quarter" />
          <div className="mt-4">
            <DepartmentChart />
          </div>
        </Card>

        <Card className="flex flex-col p-5">
          <CardHeading title="Recent Activity" />
          <ul className="mt-3 flex-1 space-y-4">
            {RECENT_ACTIVITY.map((item) => (
              <li key={item.id + item.time} className="flex gap-3">
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${ACTIVITY_DOT[item.tone]}`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm text-ink-700">
                    <span className="font-semibold text-brand-600">#{item.id}</span> {item.text}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-400">{item.time}</p>
                </div>
              </li>
            ))}
          </ul>
          <Link
            href="/my-requests"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            View all requests
            <ArrowUpRight className="size-4" />
          </Link>
        </Card>
      </div>
    </>
  );
}
