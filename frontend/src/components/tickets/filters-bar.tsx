"use client";

import { useState } from "react";
import { Calendar, Search } from "lucide-react";

import { Input, Select } from "@/components/ui/field";
import { DateField } from "@/components/tickets/date-field";
import { DEPARTMENTS } from "@/lib/data";
import type { TicketPriority, TicketStatus } from "@/lib/types";

const STATUSES: TicketStatus[] = [
  "New",
  "Accepted",
  "In Progress",
  "Waiting",
  "Completed",
  "Overdue",
];

const PRIORITIES: TicketPriority[] = ["Low", "Medium", "High", "Critical"];

const COMPACT = "h-11 text-[13px]";
/* Selects carry their own chevron, so they trim the default field padding to
   keep every filter on one row. */
const COMPACT_SELECT = COMPACT + " pr-8 pl-3";

export function FiltersBar({ action }: { action?: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("2025-09-01");
  const [to, setTo] = useState("2025-09-30");

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-4">
      <div className="w-full lg:min-w-44 lg:flex-1">
        <Input
          className={COMPACT}
          icon={<Search className="text-ink-400" />}
          placeholder="Search by ticket ID, subject or keyword..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search requests"
        />
      </div>

      <Select className={COMPACT_SELECT + " min-w-[116px] flex-1 lg:w-40 lg:flex-none"} defaultValue="" aria-label="Filter by department">
        <option value="">All Departments</option>
        {DEPARTMENTS.map((department) => (
          <option key={department}>{department}</option>
        ))}
      </Select>

      <Select className={COMPACT_SELECT + " min-w-[116px] flex-1 lg:w-28 lg:flex-none"} defaultValue="" aria-label="Filter by status">
        <option value="">All Status</option>
        {STATUSES.map((status) => (
          <option key={status}>{status}</option>
        ))}
      </Select>

      <Select className={COMPACT_SELECT + " min-w-[116px] flex-1 lg:w-32 lg:flex-none"} defaultValue="" aria-label="Filter by priority">
        <option value="">All Priorities</option>
        {PRIORITIES.map((priority) => (
          <option key={priority}>{priority}</option>
        ))}
      </Select>

      <div className="flex h-11 w-full shrink-0 items-center rounded-field sm:w-auto border border-line-strong bg-surface pl-3 focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/10">
        <Calendar className="size-4.5 shrink-0 text-ink-400" />
        <DateField
          value={from}
          onChange={setFrom}
          clearable={false}
          showIcon={false}
          bare
          className="w-23"
          placeholder="From"
        />
        <span className="text-sm text-ink-400">-</span>
        <DateField
          value={to}
          onChange={setTo}
          clearable={false}
          showIcon={false}
          bare
          className="w-23"
          placeholder="To"
        />
      </div>

      {action}
    </div>
  );
}
