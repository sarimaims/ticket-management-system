"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { useRegisterPageTitle } from "@/components/layout/page-title";

export type Crumb = { label: string; href?: string };

/**
 * Breadcrumb and actions on one row. The page name itself is published to the
 * topbar rather than repeated here, which keeps the body starting higher.
 */
export function PageHeader({
  title,
  crumbs,
  backHref,
  actions,
}: {
  title: string;
  crumbs: Crumb[];
  backHref?: string;
  actions?: React.ReactNode;
}) {
  useRegisterPageTitle(title);

  return (
    <div className="mb-4 flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 transition-colors hover:text-brand-600"
          >
            <ArrowLeft className="size-4" />
            Back
          </Link>
        )}

        {backHref && <span className="h-4 w-px bg-line-strong" />}

        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm">
            {crumbs.map((crumb, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li key={crumb.label} className="flex items-center gap-1.5">
                  {crumb.href && !last ? (
                    <Link
                      href={crumb.href}
                      className="text-ink-500 transition-colors hover:text-ink-800"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={last ? "font-semibold text-brand-600" : "text-ink-500"}>
                      {crumb.label}
                    </span>
                  )}
                  {!last && <ChevronRight className="size-4 text-ink-300" />}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {actions}
    </div>
  );
}
