import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { APP_NAME, pageTitle } from "@/lib/app-info";
import { AuroraEyebrow } from "@/components/aurora-backdrop";
import { serverEnv } from "@/lib/env.server";

export const metadata: Metadata = {
  title: pageTitle("Sign in"),
  description: "Sign in to your mess account.",
};

export default async function LoginPage(props: { searchParams: Promise<{ next?: string }> }) {
  // Next 16: searchParams is a Promise. The synchronous form is gone.
  const { next } = await props.searchParams;

  // Only ever forward an in-app path. An absolute URL here would let a crafted
  // link bounce a freshly-authenticated user onto a phishing page.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;

  const appOnly = serverEnv.WEB_SIGNIN_APP_ONLY;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <AuroraEyebrow>{appOnly ? "Admin sign in" : "Sign in"}</AuroraEyebrow>
        <h1 className="text-3xl font-black tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {appOnly
            ? `Mess admins sign in with their email. Students and counter staff: use the ${APP_NAME} app.`
            : "Admins and staff: use your email address. Students: your mobile number."}
        </p>
      </div>

      <LoginForm appOnly={appOnly} {...(safeNext ? { next: safeNext } : {})} />
    </div>
  );
}
