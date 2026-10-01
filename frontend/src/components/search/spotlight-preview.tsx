"use client";

import { Fragment } from "react";

import {
  Building,
  ExternalLink,
  FileText,
  Link2,
  MessageSquareText,
  Paperclip,
  Ticket,
  Users,
} from "lucide-react";

import { PriorityBadge, RoleTag, statusToneClasses } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { initials } from "@/lib/auth";
import type { LibraryItem } from "@/lib/library";
import { formatPhone } from "@/lib/phone";
import type { SearchDepartment, SearchMessage, SearchPerson, SearchTicket, SearchUnit } from "@/lib/search";
import { STATUS_LABEL, isSettled, type TicketStatus } from "@/lib/types";
import { cn, formatDateOf, formatTime } from "@/lib/utils";

import type { SpotAction } from "./spotlight-actions";

/** A status as a pill, for anything the badge does not know (older data). */
export function StatusPill({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        statusToneClasses(status) ?? "bg-ink-100 text-ink-600",
        className,
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** "Today", "Yesterday" or the date, then the time. */
export function when(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const day =
    date.toDateString() === today.toDateString()
      ? "Today"
      : date.toDateString() === yesterday.toDateString()
        ? "Yesterday"
        : formatDateOf(iso);
  return `${day}, ${formatTime(iso)}`;
}

export function fileSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One labelled line of the preview. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 py-1.5 text-[12px]">
      <dt className="text-ink-400">{label}</dt>
      <dd className="min-w-0 font-medium break-words text-ink-800">{children}</dd>
    </div>
  );
}

/** A button along the foot of the preview, with the key that does the same. */
export function PreviewButton({
  onClick,
  href,
  icon: Icon,
  label,
  keys,
  primary,
}: {
  onClick?: () => void;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  keys?: string;
  primary?: boolean;
}) {
  const className = cn(
    "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors",
    primary
      ? "bg-ink-900 text-white hover:bg-ink-800"
      : "border border-line bg-white/70 text-ink-700 hover:bg-white",
  );
  const body = (
    <>
      <Icon className="size-3.5" />
      {label}
      {keys && (
        <kbd className={cn("ml-0.5 font-sans text-[10px]", primary ? "text-white/60" : "text-ink-400")}>
          {keys}
        </kbd>
      )}
    </>
  );
  return href ? (
    <a href={href} className={className} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

function Header({
  icon,
  title,
  sub,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 pt-6 pb-4 text-center">
      {icon}
      <h3 className="mt-3 line-clamp-3 text-[15px] leading-snug font-bold text-ink-900">{title}</h3>
      {sub && <p className="mt-1 text-[12px] text-ink-500">{sub}</p>}
    </div>
  );
}

const Tile = ({ className, children }: { className: string; children: React.ReactNode }) => (
  <span className={cn("grid size-14 place-items-center rounded-2xl shadow-sm", className)}>{children}</span>
);

export function TicketPreview({ ticket, actions }: { ticket: SearchTicket; actions: React.ReactNode }) {
  const late = ticket.status === "Overdue";
  return (
    <>
      <Header
        icon={
          <Tile className="bg-gradient-to-b from-brand-500 to-brand-700 text-white">
            <Ticket className="size-6" />
          </Tile>
        }
        title={ticket.subject}
        sub={
          <span className="inline-flex items-center gap-1.5">
            <span className="font-bold text-ink-700">{ticket.number}</span>
            <StatusPill status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </span>
        }
      />
      <dl className="mx-4 divide-y divide-line border-y border-line">
        <Row label={ticket.departments.length > 1 ? "Departments" : "Department"}>
          {ticket.departments.map((department) => (
            <span key={department.id} className="block">
              {department.name}
              {department.unit && <span className="text-ink-400"> · {department.unit}</span>}
            </span>
          ))}
        </Row>
        <Row label="Raised by">{ticket.raisedBy.name || "—"}</Row>
        <Row label="Assigned to">
          {ticket.assignees.length > 0 ? (
            ticket.assignees.map((person) => person.name).join(", ")
          ) : (
            <span className="text-status-waiting-fg">Not picked up</span>
          )}
        </Row>
        <Row label="Due">
          {ticket.deadline ? (
            <span className={cn(late && "text-status-overdue-fg")}>
              {formatDateOf(ticket.deadline)}
              {late && " · late"}
            </span>
          ) : (
            <span className="text-ink-400">{isSettled(ticket.status) ? "—" : "No date promised"}</span>
          )}
        </Row>
        <Row label="Activity">
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <MessageSquareText className="size-3.5 text-ink-400" />
              {ticket.messageCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <Paperclip className="size-3.5 text-ink-400" />
              {ticket.attachmentCount}
            </span>
            <span className="text-ink-500">Updated {when(ticket.updatedAt)}</span>
          </span>
        </Row>
      </dl>
      {ticket.match ? (
        <p className="mx-4 mt-3 rounded-xl bg-status-waiting-bg/60 px-3 py-2 text-[12px] leading-relaxed text-ink-700">
          <span className="block text-[10px] font-bold tracking-wide text-status-waiting-fg uppercase">
            Found in the {ticket.match.field}
          </span>
          {ticket.match.text}
        </p>
      ) : (
        ticket.description && (
          <p className="mx-4 mt-3 line-clamp-5 text-[12px] leading-relaxed text-ink-600">{ticket.description}</p>
        )
      )}
      <Actions>{actions}</Actions>
    </>
  );
}

export function PersonPreview({ person, actions }: { person: SearchPerson; actions: React.ReactNode }) {
  return (
    <>
      <Header
        icon={
          <Avatar
            initials={initials(person.name)}
            tone={person.departments.some((item) => item.role === "head") || person.role !== "user" ? "head" : "team"}
            className="size-14 text-base shadow-sm"
          />
        }
        title={person.name}
        sub={person.designation || (person.role !== "user" ? "Admin" : "")}
      />
      <dl className="mx-4 divide-y divide-line border-y border-line">
        <Row label="Email">
          <a href={`mailto:${person.email}`} className="hover:text-brand-600">
            {person.email}
          </a>
        </Row>
        <Row label="Phone">
          {person.phone ? (
            <a href={`tel:${person.phone}`} className="hover:text-brand-600">
              {formatPhone(person.phone)}
            </a>
          ) : (
            <span className="text-ink-400">Not given</span>
          )}
        </Row>
        {/* Where they sit, each fact on its own labelled line. Somebody in
            several departments gets one group per department, numbered. */}
        {person.departments.map((item, index) => (
          <Fragment key={item.id}>
            {person.departments.length > 1 && (
              <p className="pt-2.5 pb-1 text-[10px] font-bold tracking-wide text-ink-400 uppercase">
                Position {index + 1} of {person.departments.length}
              </p>
            )}
            <Row label="Unit">{item.unit || <span className="text-ink-400">No unit</span>}</Row>
            <Row label="Department">{item.name}</Row>
            <Row label="Designation">
              {item.designation || <span className="text-ink-400">Not set</span>}
            </Row>
            <Row label="Role">
              <RoleTag role={item.role} />
            </Row>
          </Fragment>
        ))}
        {person.status !== "active" && (
          <Row label="Account">
            <span className="capitalize text-status-overdue-fg">{person.status}</span>
          </Row>
        )}
      </dl>
      <Actions>{actions}</Actions>
    </>
  );
}

export function DepartmentPreview({
  department,
  actions,
}: {
  department: SearchDepartment;
  actions: React.ReactNode;
}) {
  return (
    <>
      <Header
        icon={
          <Tile className="bg-gradient-to-b from-violet-400 to-violet-600 text-white">
            <Users className="size-6" />
          </Tile>
        }
        title={department.name}
        sub={department.unit?.name}
      />
      <dl className="mx-4 divide-y divide-line border-y border-line">
        <Row label="Members">
          {department.members} · {department.heads} {department.heads === 1 ? "head" : "heads"}
        </Row>
        <Row label="You are">
          {department.myRole ? (
            <RoleTag role={department.myRole} />
          ) : (
            <span className="text-ink-500">Not a member - you can raise tickets to it</span>
          )}
        </Row>
        {!department.isActive && (
          <Row label="Status">
            <span className="text-status-overdue-fg">Inactive</span>
          </Row>
        )}
      </dl>
      {department.description && (
        <p className="mx-4 mt-3 text-[12px] leading-relaxed text-ink-600">{department.description}</p>
      )}
      <Actions>{actions}</Actions>
    </>
  );
}

export function UnitPreview({ unit, actions }: { unit: SearchUnit; actions: React.ReactNode }) {
  return (
    <>
      <Header
        icon={
          <Tile className="bg-gradient-to-b from-sky-400 to-sky-600 text-white">
            <Building className="size-6" />
          </Tile>
        }
        title={unit.name}
        sub={`${unit.departments} ${unit.departments === 1 ? "department" : "departments"}`}
      />
      {unit.description && (
        <p className="mx-4 border-t border-line pt-3 text-[12px] leading-relaxed text-ink-600">{unit.description}</p>
      )}
      <Actions>{actions}</Actions>
    </>
  );
}

export function FilePreview({ item, actions }: { item: LibraryItem; actions: React.ReactNode }) {
  const isLink = item.type === "link";
  return (
    <>
      <div className="px-4 pt-4">
        {item.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived S3 links
          <img
            src={item.url}
            alt={item.filename}
            className="mx-auto max-h-44 w-full rounded-xl border border-line bg-ink-50 object-contain"
          />
        ) : item.type === "video" ? (
          <video
            src={item.url}
            muted
            preload="metadata"
            controls
            className="mx-auto max-h-44 w-full rounded-xl border border-line bg-ink-900"
          />
        ) : (
          <div className="grid h-28 place-items-center rounded-xl border border-line bg-gradient-to-b from-white to-ink-50">
            {isLink ? <Link2 className="size-9 text-sky-500" /> : <FileText className="size-9 text-ink-400" />}
          </div>
        )}
      </div>
      <h3 className="mx-4 mt-3 line-clamp-2 text-[14px] font-bold break-all text-ink-900">
        {isLink ? item.url.replace(/^https?:\/\//, "") : item.filename || "Untitled file"}
      </h3>
      <dl className="mx-4 mt-2 divide-y divide-line border-y border-line">
        {!isLink && <Row label="Size">{fileSize(item.size)}</Row>}
        <Row label="Shared by">{item.by.name}</Row>
        <Row label="When">{when(item.createdAt)}</Row>
        <Row label="Ticket">
          {item.ticket.number} · {item.ticket.subject}
        </Row>
      </dl>
      {isLink && item.context && (
        <p className="mx-4 mt-3 line-clamp-4 text-[12px] leading-relaxed text-ink-600">{item.context}</p>
      )}
      <Actions>{actions}</Actions>
    </>
  );
}

export function MessagePreview({ message, actions }: { message: SearchMessage; actions: React.ReactNode }) {
  return (
    <>
      <Header
        icon={<Avatar initials={initials(message.author.name)} tone="team" className="size-14 text-base shadow-sm" />}
        title={message.author.name}
        sub={when(message.createdAt)}
      />
      <div className="mx-4 rounded-2xl rounded-tl-md bg-ink-100/80 px-3 py-2 text-[12.5px] leading-relaxed text-ink-800">
        {message.body}
      </div>
      <p className="mx-4 mt-3 flex items-center gap-1.5 text-[12px] text-ink-500">
        <Ticket className="size-3.5" />
        <span className="font-bold text-ink-700">{message.ticket.number}</span>
        <span className="truncate">{message.ticket.subject}</span>
      </p>
      <Actions>{actions}</Actions>
    </>
  );
}

export function ActionPreview({ action, onRun }: { action: SpotAction; onRun: () => void }) {
  const Icon = action.icon;
  return (
    <>
      <Header
        icon={
          <Tile className="bg-gradient-to-b from-ink-700 to-ink-900 text-white">
            <Icon className="size-6" />
          </Tile>
        }
        title={action.label}
        sub={action.hint}
      />
      <p className="mx-4 flex items-center justify-center gap-2 border-t border-line pt-3 text-[12px] text-ink-500">
        Quick key
        <kbd className="rounded-md border border-line bg-white px-1.5 py-0.5 font-sans text-[11px] font-bold text-ink-700 shadow-xs">
          {action.quickKey}
        </kbd>
      </p>
      <Actions>
        <PreviewButton primary icon={ExternalLink} label="Open" keys="↵" onClick={onRun} />
      </Actions>
    </>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mt-auto flex flex-wrap justify-center gap-1.5 px-4 pt-4 pb-4">{children}</div>;
}

