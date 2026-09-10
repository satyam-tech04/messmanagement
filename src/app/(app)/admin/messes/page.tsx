import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TableEmpty, TableError, TableFooterBar, TableShell } from "@/components/data-table";
import { canSwitchTenant, type SwitchableTenant } from "@/core/policies/tenant-switch.policy";
import { requireSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseTenantDirectory } from "@/infra/supabase/repositories";
import { createClient } from "@/infra/supabase/server";
import { SwitchMessButton } from "./switch-button";
import { pageTitle } from "@/lib/app-info";

export const metadata: Metadata = { title: pageTitle("Messes") };

// Never cached. The whole point of this screen is which mess you are in right
// now, and a stale answer to that question is worse than no answer.
export const dynamic = "force-dynamic";

const COLUMNS = ["Mess", "Identifier", "Students", "Status", ""];

export default async function MessesPage() {
  const user = await requireSessionUser();

  // `proxy.ts` gates /admin by role from the JWT, but its coarsest gate lets any
  // ADMIN through — this route needs the narrower one. 404 rather than a
  // redirect: a mess admin should not learn that a platform screen exists.
  if (!canSwitchTenant(user.role)) notFound();

  const supabase = await createClient();
  const admin = createAdminClient();

  let tenants: SwitchableTenant[];
  let loadError: string | null = null;
  try {
    tenants = await new SupabaseTenantDirectory(supabase, admin).listSwitchable();
  } catch (e) {
    tenants = [];
    loadError = e instanceof Error ? e.message : "The mess list could not be read.";
  }

  // Counted with the service-role client, because RLS confines even a platform
  // admin to the one mess they are currently in — that confinement is the whole
  // security model here and is not being loosened for a number on a screen.
  // Each count is filtered by an explicit tenant_id, per the rule in admin.ts,
  // and no student row itself is read.
  const counts = new Map<string, number>();
  await Promise.all(
    tenants.map(async (t) => {
      const { count } = await admin
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", t.id);
      counts.set(t.id, count ?? 0);
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messes"
        description="Every hostel on the platform. Switching moves your account into that mess — you become its admin and lose sight of the others, exactly as its own admin does. One mess at a time, always."
      />

      {loadError ? (
        <TableError
          description={`The list of messes could not be loaded. ${loadError}`}
          retryHref="/admin/messes"
        />
      ) : tenants.length === 0 ? (
        <TableEmpty
          icon={<Building2 className="size-6" aria-hidden="true" />}
          title="No messes on the platform"
          description="Provision the first one with `npm run provision`. Until a mess exists there is nothing to administer."
        />
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((c, i) => (
                  <TableHead
                    key={c || i}
                    className={
                      c === "Students" ? "text-right" : i === COLUMNS.length - 1 ? "w-0" : undefined
                    }
                  >
                    {c || <span className="sr-only">Actions</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => {
                const current = tenant.id === user.tenantId;
                const studentCount = counts.get(tenant.id) ?? 0;
                return (
                  <TableRow key={tenant.id} className={current ? "bg-primary/5" : undefined}>
                    <TableCell className="font-medium">
                      {tenant.name}
                      {current ? (
                        <span className="text-primary block text-xs font-normal">You are here</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-sm">
                      {tenant.slug}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {studentCount}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={tenant.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        {current ? (
                          <span className="text-muted-foreground text-sm">Current</span>
                        ) : tenant.status === "ACTIVE" ? (
                          <SwitchMessButton
                            tenantId={tenant.id}
                            tenantName={tenant.name}
                            studentCount={studentCount}
                          />
                        ) : (
                          // Deliberately not a disabled button with no
                          // explanation — the reason it cannot be entered is
                          // the useful part.
                          <span className="text-muted-foreground text-sm">Reactivate to enter</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <TableFooterBar shown={tenants.length} total={tenants.length} noun="messes" />
        </TableShell>
      )}
    </div>
  );
}
