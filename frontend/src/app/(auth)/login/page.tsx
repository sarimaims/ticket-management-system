import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in — AIVIN",
};

export default function LoginPage() {
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to raise and track your department requests."
      footer={<>Accounts are created by your super admin under Departments.</>}
    >
      <LoginForm />
    </AuthShell>
  );
}
