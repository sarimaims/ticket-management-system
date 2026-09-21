import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { Logo } from "@/components/layout/logo";

const POINTS = [
  "Raise a request to any department in seconds.",
  "Track every ticket from New through to Completed.",
  "Deadlines, owners and priorities in one place.",
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Brand panel: decorative, so it drops away entirely on small screens. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-700 px-10 py-12 lg:flex">
        <div
          className="absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(120% 90% at 10% 0%, var(--color-brand-500) 0%, var(--color-brand-700) 45%, var(--color-brand-900) 100%)",
          }}
          aria-hidden="true"
        />

        <div className="relative">
          <Link href="/login">
            <Logo tone="light" />
          </Link>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl leading-tight font-bold text-white">
            Every request, every department, one queue.
          </h2>
          <ul className="mt-7 space-y-4">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[15px] text-brand-50">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-200" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-brand-200">
          © {new Date().getFullYear()} FlowDesk. Internal ticket management.
        </p>
      </aside>

      <main className="flex items-center justify-center bg-surface px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-ink-900">{title}</h1>
          <p className="mt-1.5 text-[15px] text-ink-500">{subtitle}</p>

          <div className="mt-7">{children}</div>

          {footer && <div className="mt-6 text-sm text-ink-500">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
