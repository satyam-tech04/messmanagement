/**
 * Creates (or repairs) the platform operator account.
 *
 * This is the one login that can move between messes. It is not a customer
 * account and belongs to nobody at any hostel — it exists so one person can
 * support every mess on the platform without holding a password for each.
 *
 * How the cross-tenant access actually works is described in
 * `src/core/services/switch-tenant.ts`, and it is worth knowing before running
 * this: the operator is NOT granted sight of every tenant at once. Their
 * profile is moved into whichever mess they pick, so at any instant they are an
 * ordinary admin of exactly one hostel and RLS confines them as tightly as it
 * confines a real mess admin. That is why creating this account required no
 * migration and no policy change.
 *
 * Idempotent (rule 5): running it twice repairs the account rather than failing
 * or creating a second one.
 *
 *   npm run create:superadmin
 */
import { createClient } from "@supabase/supabase-js";
import { SUPER_USER_EMAIL, SUPER_USER_IDENTIFIER } from "../src/core/domain/identity";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/** The mess the operator lands in before switching. */
const HOME_SLUG = "campus-crave";

const PASSWORD = "superuser";

function die(message: string): never {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

async function findAuthUserByEmail(email: string): Promise<string | null> {
  // listUsers is paginated; the operator account is created early, but paging
  // rather than assuming page one keeps this correct as the platform grows.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`Could not read the user list: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main(): Promise<void> {
  console.log(`\n  Platform operator account`);
  console.log(`    sign in with : ${SUPER_USER_IDENTIFIER}`);
  console.log(`    auth address : ${SUPER_USER_EMAIL}`);
  console.log(`    home mess    : ${HOME_SLUG}\n`);

  const { data: home, error: homeError } = await db
    .from("tenants")
    .select("id, name")
    .eq("slug", HOME_SLUG)
    .maybeSingle();

  if (homeError) die(`Could not read the mess list: ${homeError.message}`);
  if (!home) die(`No mess with the identifier "${HOME_SLUG}". Provision it first.`);

  const existingId = await findAuthUserByEmail(SUPER_USER_EMAIL);

  let userId: string;
  if (existingId) {
    // Repair rather than refuse: the usual reason for re-running this is a
    // forgotten password, and failing here would leave the operator locked out
    // with no other way in.
    const { error } = await db.auth.admin.updateUserById(existingId, { password: PASSWORD });
    if (error) die(`Could not reset the operator password: ${error.message}`);
    userId = existingId;
    console.log("  ✔ existing operator login found — password reset");
  } else {
    const { data: created, error } = await db.auth.admin.createUser({
      email: SUPER_USER_EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Platform Admin" },
    });
    if (error || !created.user) die(`Could not create the operator login: ${error?.message}`);
    userId = created.user.id;
    console.log("  ✔ operator login created");
  }

  // `email` is left null on purpose. This address is undeliverable by design,
  // and `profiles.email` is documented as a real, contactable address —
  // writing a fake one there would put a lie in the column other screens trust.
  const { error: profileError } = await db.from("profiles").upsert(
    {
      id: userId,
      tenant_id: home.id,
      role: "SUPER_ADMIN",
      full_name: "Platform Admin",
      status: "ACTIVE",
      // Deliberately false. The whole point of this account is that the
      // operator signs in with a password they already know; forcing a change
      // would lock them out of the one login that has no recovery path.
      must_change_password: false,
    },
    { onConflict: "id" },
  );

  if (profileError) die(`Login exists, but the profile failed: ${profileError.message}`);
  console.log(`  ✔ profile set to SUPER_ADMIN, home mess "${home.name}"\n`);

  console.log("  ─────────────────────────────────────────────");
  console.log("   Platform operator ready");
  console.log("  ─────────────────────────────────────────────");
  console.log(
    `   Sign in URL : ${process.env.NEXT_PUBLIC_APP_URL ?? "(set NEXT_PUBLIC_APP_URL)"}/login`,
  );
  console.log(`   Username    : ${SUPER_USER_IDENTIFIER}`);
  console.log(`   Password    : ${PASSWORD}`);
  console.log("  ─────────────────────────────────────────────");
  console.log("   Then: sidebar → Platform → Messes → Switch.\n");
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
