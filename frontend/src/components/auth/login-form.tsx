"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Lock, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useAuth } from "@/components/auth/auth-provider";
import { errorMessage } from "@/lib/api";
import { login } from "@/lib/auth";

export function LoginForm() {
  const router = useRouter();
  const { setAuth } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const next: typeof errors = {};
    if (!email.trim()) next.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.email = "Enter a valid email address.";
    if (!password) next.password = "Password is required.";

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    try {
      setAuth(await login(email.trim(), password));
      router.push("/dashboard");
    } catch (error) {
      setErrors({ form: errorMessage(error) });
      setPending(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      {errors.form && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-field border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700"
        >
          <AlertCircle className="mt-0.5 size-4.5 shrink-0" />
          {errors.form}
        </div>
      )}

      <Field label="Email" required htmlFor="email" error={errors.email}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          icon={<Mail className="text-ink-500" />}
          placeholder="you@flowdesk.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>

      <Field label="Password" required htmlFor="password" error={errors.password}>
        <Input
          id="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          icon={<Lock className="text-ink-500" />}
          placeholder="Enter your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
            </button>
          }
        />
      </Field>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input
            type="checkbox"
            className="size-4 rounded border-line-strong accent-brand-600"
            defaultChecked
          />
          Keep me signed in
        </label>
        <button type="button" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          Forgot password?
        </button>
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in..." : "Sign In"}
      </Button>
    </form>
  );
}
