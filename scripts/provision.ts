/**
 * Creates a new mess, for a real customer, against production.
 *
 *   npm run provision -- --name "Sunrise Hostel Mess" \
 *                        --slug sunrise-mess \
 *                        --email owner@example.com
 *
 * **Strictly additive.** This is the opposite of `seed.ts`, which begins by
 * deleting the tenants it is about to create — safe for demo data, catastrophic
 * for a paying customer. Nothing here deletes, and an existing slug is refused
 * rather than overwritten.
 *
 * If a later step fails, what was already written is left in place and reported,
 * because the alternative — tearing down a half-built tenant — risks removing
 * something that was already there. Re-running after a fix is safe: every step
 * checks first.
 *
 * The validation lives in `src/core/policies/provision.policy.ts` so that a
 * SUPER_ADMIN screen can later use exactly the same rules rather than a second
 * copy that drifts.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { parseMessProvision } from "../src/core/policies/provision.policy";
import { generateTemporaryPassword } from "../src/lib/password";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/** `--name "X" --slug y --email z` */
function arg(flag: string): string {
  const i = process.argv.indexOf(`--${flag}`);
  return i === -1 ? "" : (process.argv[i + 1] ?? "");
}

function die(message: string): never {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const parsed = parseMessProvision({
    name: arg("name"),
    slug: arg("slug"),
    adminEmail: arg("email"),
  });

  if (!parsed.ok) die(parsed.error.message);
  const { name, slug, adminEmail, timezone } = parsed.value;

  console.log(`\n  Provisioning "${name}"`);
  console.log(`    identifier : ${slug}`);
  console.log(`    timezone   : ${timezone}`);
  console.log(`    admin      : ${adminEmail}\n`);

  // --- 1. Refuse rather than overwrite -------------------------------------
  const { data: clash } = await db.from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (clash) {
    die(
      `A mess with the identifier "${slug}" already exists. ` +
        `Choose another — this script never modifies an existing mess.`,
    );
  }

  // --- 2. Tenant ------------------------------------------------------------
  const { data: tenant, error: tenantError } = await db
    .from("tenants")
    .insert({ slug, name, timezone, type: "HOSTEL", status: "ACTIVE" })
    .select("id")
    .single();

  if (tenantError || !tenant) die(`Could not create the mess: ${tenantError?.message}`);
  console.log(`  ✔ mess created (${tenant.id})`);

  // --- 3. Settings ----------------------------------------------------------
  //
  // Defaults only. Meal windows, the QR rotation and the absence rules are all
  // the owner's decisions and belong on the settings screen, not in a flag on
  // this command.
  const { error: settingsError } = await db
    .from("tenant_settings")
    .insert({ tenant_id: tenant.id });
  if (settingsError) die(`Mess created, but settings failed: ${settingsError.message}`);
  console.log("  ✔ default settings written");

  // --- 4. QR signing secret -------------------------------------------------
  //
  // Per-tenant and generated here, never shared or derived. A secret that leaked
  // between messes would let one mint attendance for another's students.
  // 48 random bytes, well past the 32-character constraint.
  const { error: secretError } = await db
    .from("tenant_secrets")
    .insert({ tenant_id: tenant.id, qr_signing_secret: randomBytes(48).toString("base64url") });
  if (secretError) die(`Mess created, but the signing secret failed: ${secretError.message}`);
  console.log("  ✔ QR signing secret generated");

  // --- 5. Admin login -------------------------------------------------------
  const password = generateTemporaryPassword();
  const { data: created, error: authError } = await db.auth.admin.createUser({
    email: adminEmail,
    password,
    // A real address, unlike a student's synthetic one — but confirming it would
    // mean the owner cannot sign in until they click a link, on a day when
    // someone is standing over them waiting to see the product work.
    email_confirm: true,
    user_metadata: { full_name: name },
  });

  if (authError || !created.user) {
    die(
      `Mess created, but the admin login failed: ${authError?.message}. ` +
        `Fix the email and re-run — the existing mess will be refused, so create the ` +
        `login by hand or remove the mess first.`,
    );
  }

  const { error: profileError } = await db.from("profiles").insert({
    id: created.user.id,
    tenant_id: tenant.id,
    role: "ADMIN",
    full_name: name,
    email: adminEmail,
    status: "ACTIVE",
    // The person running this script knows the password, so it is not yet the
    // owner's account until they change it.
    must_change_password: true,
  });

  if (profileError) {
    await db.auth.admin.deleteUser(created.user.id).catch(() => {});
    die(`Mess created, but the admin profile failed: ${profileError.message}`);
  }
  console.log("  ✔ admin account created\n");

  console.log("  ─────────────────────────────────────────────");
  console.log("   Give these to the mess owner. Shown once.");
  console.log("  ─────────────────────────────────────────────");
  console.log(
    `   Sign in : ${process.env.NEXT_PUBLIC_APP_URL ?? "(set NEXT_PUBLIC_APP_URL)"}/login`,
  );
  console.log(`   Email   : ${adminEmail}`);
  console.log(`   Password: ${password}`);
  console.log("  ─────────────────────────────────────────────");
  console.log("   They must change it at first sign-in.\n");

  console.log("  Next, in the app:");
  console.log("    1. Settings  — set the meal windows this mess actually serves");
  console.log("    2. Plans     — create the plans before importing anyone");
  console.log("    3. Students  — import the roster, or add a few by hand");
  console.log("    4. Menu      — set at least today's menu\n");
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
