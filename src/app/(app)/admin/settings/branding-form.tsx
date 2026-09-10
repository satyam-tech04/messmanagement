"use client";

/**
 * How this mess appears to its own members.
 *
 * Once a student or staff member signs in they are inside *their hostel's* app —
 * the MealAdda mark stays on the store listing and the login screen, the two
 * places somebody has not yet identified which mess they belong to. What they
 * see everywhere after that is set here.
 *
 * Deliberately no colour picker. A per-tenant palette would mean re-verifying
 * every contrast pairing in the app for every hostel that signs up, and one
 * would eventually choose something unreadable on a counter tablet under
 * kitchen lighting.
 */
import Image from "next/image";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { removeLogo, updateBranding, type SettingsActionState } from "./actions";

const MAX_LOGO_BYTES = 1_048_576;

export function BrandingForm({ tenantName, hasLogo }: { tenantName: string; hasLogo: boolean }) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    updateBranding,
    {},
  );
  const [removeState, removeAction, removing] = useActionState<SettingsActionState, FormData>(
    async () => removeLogo(),
    {},
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);

  const outcome = state.error || removeState.error || state.success || removeState.success;
  const failed = Boolean(state.error || removeState.error);

  return (
    <Card>
      <CardHeader>
        <CardTitle>How your mess appears</CardTitle>
        <CardDescription>
          Your name and logo are what students and staff see throughout the app once they sign in.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="tenantName">Mess name</Label>
            <Input
              id="tenantName"
              name="tenantName"
              defaultValue={tenantName}
              maxLength={120}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="logo">Logo</Label>
            <div className="flex items-center gap-4">
              <div className="bg-muted flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
                {preview ? (
                  // A local object URL for a file that has not been uploaded
                  // yet. `next/image` would try to optimise a blob: URL, which
                  // it cannot fetch — so the raw element is correct here.
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={preview} alt="" className="size-full object-contain" />
                ) : hasLogo ? (
                  <Image
                    src="/api/tenant/logo"
                    alt=""
                    width={64}
                    height={64}
                    className="size-full object-contain"
                    unoptimized
                  />
                ) : (
                  <span className="text-muted-foreground text-xs">None</span>
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                <Input
                  id="logo"
                  name="logo"
                  type="file"
                  ref={fileRef}
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Checked here as a courtesy; storage enforces the same
                    // limit, so a bypass costs an upload rather than a rule.
                    setTooLarge(Boolean(file && file.size > MAX_LOGO_BYTES));
                    setPreview(file ? URL.createObjectURL(file) : null);
                  }}
                />
                <p className="text-muted-foreground text-xs">
                  PNG, JPEG, WebP or SVG, up to 1&nbsp;MB. A square image works best.
                </p>
                {tooLarge && (
                  <p className="text-destructive text-xs" role="alert">
                    That image is over 1&nbsp;MB. Choose a smaller one.
                  </p>
                )}
              </div>
            </div>
          </div>

          {outcome && (
            <p
              // Announced, not merely coloured: a form that appears to do
              // nothing is the most common way a save goes unnoticed.
              role="alert"
              className={
                failed ? "text-destructive text-sm" : "text-sm font-medium text-emerald-600"
              }
            >
              {outcome}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || tooLarge}>
              {pending ? "Saving…" : "Save"}
            </Button>

            {hasLogo && (
              <Button
                type="button"
                variant="ghost"
                disabled={removing}
                onClick={() => {
                  // Submitted through its own action so removal never depends on
                  // the name field being valid.
                  setPreview(null);
                  if (fileRef.current) fileRef.current.value = "";
                  removeAction(new FormData());
                }}
              >
                {removing ? "Removing…" : "Remove logo"}
              </Button>
            )}
          </div>

          <p className="text-muted-foreground text-xs">
            Members see the change the next time they open the app. Colours stay the same for every
            mess, so that every screen keeps the contrast it was checked for.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
