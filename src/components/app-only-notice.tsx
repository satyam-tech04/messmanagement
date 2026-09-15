import { LogOut, Smartphone } from "lucide-react";
import { AuroraBackdrop, AuroraEyebrow, AuroraMark } from "@/components/aurora-backdrop";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/navigation";
import { APP_NAME } from "@/lib/app-info";
import type { UserRole } from "@/core/domain/enums";

/**
 * Shown to a student or counter-staff session on the website once the
 * app-only switch is on. Says where to go instead of a bare refusal, and offers
 * the one action that helps on this device: signing out.
 */
export function AppOnlyNotice({
  fullName,
  role,
  signOutAction,
}: {
  fullName: string;
  role: UserRole;
  signOutAction: () => Promise<void>;
}) {
  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden p-6">
      <AuroraBackdrop />
      <div className="bg-card/80 relative z-10 w-full max-w-md space-y-6 rounded-3xl border p-8 text-center shadow-xl backdrop-blur-xl">
        <div className="flex justify-center">
          <AuroraMark className="size-12 rounded-2xl" />
        </div>
        <div className="space-y-3">
          <AuroraEyebrow className="justify-center">{roleLabel(role)}</AuroraEyebrow>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {fullName.split(" ")[0]}, {APP_NAME} lives on your phone
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Students and counter staff sign in on the {APP_NAME} app — your meal QR, the scanner and
            the live count are all there. This website is for mess admins.
          </p>
        </div>
        <div className="aurora-chip flex items-center gap-3 rounded-2xl p-4 text-left text-sm">
          <Smartphone className="text-aurora-1 size-5 shrink-0" aria-hidden="true" />
          <span>Open the {APP_NAME} app and sign in with the same details you used here.</span>
        </div>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" className="h-11 w-full">
            <LogOut className="size-4" aria-hidden="true" />
            Sign out of the website
          </Button>
        </form>
      </div>
    </div>
  );
}
