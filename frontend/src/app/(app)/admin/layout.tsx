import { RequireAuth } from "@/components/auth/require-auth";

/** Everything under /admin needs management rights. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth role={["superadmin", "admin"]}>{children}</RequireAuth>;
}
