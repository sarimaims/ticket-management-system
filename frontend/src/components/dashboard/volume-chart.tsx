"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { VOLUME_SERIES } from "@/lib/dashboard-data";

/* Two series, ONE axis. Colours are the validated categorical theme, consumed
   in order: chart-1 then chart-2. Identity is carried by the legend below the
   title as well as the colour, never by colour alone. */
const SERIES = [
  { key: "created", label: "Created", color: "var(--color-chart-1)" },
  { key: "resolved", label: "Resolved", color: "var(--color-chart-2)" },
] as const;

function VolumeTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-lg shadow-ink-900/5">
      <p className="mb-1.5 text-xs font-semibold text-ink-900">{label}</p>
      <ul className="space-y-1">
        {payload.map((entry) => (
          <li key={entry.dataKey as string} className="flex items-center gap-2 text-xs">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-ink-500">{entry.name}</span>
            <span className="ml-auto font-semibold text-ink-900">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VolumeChart() {
  return (
    <div>
      <ul className="mb-4 flex flex-wrap items-center gap-4">
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-2 text-xs font-medium text-ink-500">
            <span
              className="h-0.5 w-4 rounded-full"
              style={{ backgroundColor: series.color }}
              aria-hidden="true"
            />
            {series.label}
          </li>
        ))}
      </ul>

      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={VOLUME_SERIES} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <defs>
              {SERIES.map((series) => (
                <linearGradient key={series.key} id={`fill-${series.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={series.color} stopOpacity={0.14} />
                  <stop offset="100%" stopColor={series.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>

            <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" strokeWidth={1} />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tickMargin={10}
              tick={{ fill: "var(--color-chart-axis)", fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={48}
              tick={{ fill: "var(--color-chart-axis)", fontSize: 12 }}
            />
            <Tooltip
              content={VolumeTooltip}
              cursor={{ stroke: "var(--color-ink-300)", strokeWidth: 1 }}
            />

            {SERIES.map((series) => (
              <Area
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={series.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#fill-${series.key})`}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)" }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
