import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · Mess OS",
  description: "Sign in to your mess account.",
};

export default async function LoginPage(props: { searchParams: Promise<{ next?: string }> }) {
  // Next 16: searchParams is a Promise. The synchronous form is gone.
  const { next } = await props.searchParams;

  // Only ever forward an in-app path. An absolute URL here would let a crafted
  // link bounce a freshly-authenticated user onto a phishing page.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground text-sm">
          Use the roll number and password issued by your mess admin.
        </p>
      </div>

      <LoginForm {...(safeNext ? { next: safeNext } : {})} />
    </div>
  );
}
