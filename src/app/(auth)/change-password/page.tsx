import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getSessionUser, homeRouteFor } from "@/infra/auth/session";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = {
  title: "Choose a password · Mess OS",
};

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Reaching this page voluntarily with nothing to do should not trap the user.
  if (!user.mustChangePassword) redirect(homeRouteFor(user.role));

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-xl">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Choose your password</h1>
          <p className="text-muted-foreground text-sm">
            Welcome, {user.fullName.split(" ")[0]}. Your account uses a temporary password that the
            mess admin can see. Set your own to finish signing in.
          </p>
        </div>
      </div>

      <ChangePasswordForm />
    </div>
  );
}
