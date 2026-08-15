import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSessionUser, homeRouteFor } from "@/infra/auth/session";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = {
  title: "Choose a password · Mess OS",
};

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Reachable two ways: forced after an admin reset, or chosen from the account
  // menu. Previously the second case redirected away, so nobody — student,
  // staff or admin — could change their own password without asking an admin
  // to reset it first.
  const forced = user.mustChangePassword;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-xl">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {forced ? "Choose your password" : "Change your password"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {forced
              ? `Welcome, ${user.fullName.split(" ")[0]}. Your account uses a temporary password that the mess admin can see. Set your own to finish signing in.`
              : "Pick something only you know. You will stay signed in on this device."}
          </p>
        </div>
      </div>

      <ChangePasswordForm />

      {forced ? null : (
        <Button variant="ghost" size="sm" render={<Link href={homeRouteFor(user.role)} />}>
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back
        </Button>
      )}
    </div>
  );
}
