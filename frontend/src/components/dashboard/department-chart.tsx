"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { DEPARTMENT_LOAD } from "@/lib/dashboard-data";

/* Magnitude comparison -> one hue, more = darker. The rows are sorted high to
   low so the sequential ramp and the bar length tell the same story. */
const RAMP = [
  "var(--color-chart-seq-6)",
  "var(--color-chart-seq-5)",
  "var(--color-chart-seq-4)",
  "var(--color-chart-seq-3)",
  "var(--color-chart-seq-2)",
  "var(--color-chart-seq-1)",
];

function DepartmentTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0];

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg shadow-ink-900/5">
      <p className="font-semibold text-ink-900">{point.payload.department}</p>
      <p className="mt-0.5 text-ink-500">
        <span className="font-semibold text-ink-900">{point.value}</span> tickets
      </p>
    </div>
  );
}

export function DepartmentChart() {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={DEPARTMENT_LOAD}
          layout="vertical"
          margin={{ top: 0, right: 34, bottom: 0, left: 0 }}
          barCategoryGap={10}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="department"
            axisLine={false}
            tickLine={false}
            width={140}
            tick={{ fill: "var(--color-ink-500)", fontSize: 12 }}
          />
          <Tooltip content={DepartmentTooltip} cursor={{ fill: "var(--color-ink-50)" }} />
          <Bar dataKey="tickets" barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {DEPARTMENT_LOAD.map((entry, index) => (
              <Cell key={entry.department} fill={RAMP[index]} />
            ))}
            <LabelList
              dataKey="tickets"
              position="right"
              offset={10}
              className="fill-ink-600"
              fontSize={12}
              fontWeight={600}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
