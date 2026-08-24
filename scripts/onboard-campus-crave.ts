import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function die(message: string): never {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

async function createUserProfile(
  tenantId: string,
  role: "ADMIN" | "STAFF",
  fullName: string,
  email: string,
  password: string,
) {
  const { data: created, error: authError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (authError || !created.user) {
    die(`Login creation failed for ${email}: ${authError?.message}`);
  }

  const { error: profileError } = await db.from("profiles").insert({
    id: created.user.id,
    tenant_id: tenantId,
    role,
    full_name: fullName,
    email,
    status: "ACTIVE",
    must_change_password: true, // Forces password change on first login
  });

  if (profileError) {
    await db.auth.admin.deleteUser(created.user.id).catch(() => {});
    die(`Profile creation failed for ${email}: ${profileError.message}`);
  }

  console.log(`  ✔ ${role.toLowerCase()} account created for ${fullName} (${email})`);
}

async function main(): Promise<void> {
  const name = "Campus Crave";
  const slug = "campus-crave";
  const timezone = "Asia/Kolkata";

  console.log(`\n  Provisioning "${name}"`);
  console.log(`    identifier : ${slug}`);
  console.log(`    timezone   : ${timezone}\n`);

  // --- 1. Refuse rather than overwrite -------------------------------------
  const { data: clash } = await db.from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (clash) {
    die(`A mess with the identifier "${slug}" already exists.`);
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
  const { error: settingsError } = await db
    .from("tenant_settings")
    .insert({ tenant_id: tenant.id });
  if (settingsError) die(`Mess created, but settings failed: ${settingsError.message}`);
  console.log("  ✔ default settings written");

  // --- 4. QR signing secret -------------------------------------------------
  const { error: secretError } = await db
    .from("tenant_secrets")
    .insert({ tenant_id: tenant.id, qr_signing_secret: randomBytes(48).toString("base64url") });
  if (secretError) die(`Mess created, but the signing secret failed: ${secretError.message}`);
  console.log("  ✔ QR signing secret generated\n");

  // --- 5. Create Admins -------------------------------------------------------
  await createUserProfile(
    tenant.id,
    "ADMIN",
    "Shraddha",
    "shraddha.admin@campuscrave.com",
    "CampusAdmin@2026",
  );
  await createUserProfile(
    tenant.id,
    "ADMIN",
    "Harshal",
    "harshal.admin@campuscrave.com",
    "CampusAdmin@2026",
  );
  await createUserProfile(tenant.id, "ADMIN", "Admin", "admin@campuscrave.com", "CampusAdmin@2026");

  // --- 6. Create Staff -------------------------------------------------------
  await createUserProfile(
    tenant.id,
    "STAFF",
    "Roshni",
    "roshni.staff@campuscrave.com",
    "CampusStaff@2026",
  );
  await createUserProfile(
    tenant.id,
    "STAFF",
    "Satish",
    "satish.staff@campuscrave.com",
    "CampusStaff@2026",
  );
  await createUserProfile(tenant.id, "STAFF", "Staff", "staff@campuscrave.com", "CampusStaff@2026");

  console.log("\n  ─────────────────────────────────────────────");
  console.log("   Done! Credentials for the mess staff:");
  console.log("  ─────────────────────────────────────────────");
  console.log(
    `   Sign in URL : ${process.env.NEXT_PUBLIC_APP_URL ?? "(set NEXT_PUBLIC_APP_URL)"}/login\n`,
  );
  console.log(`   Admins:`);
  console.log(`   - shraddha.admin@campuscrave.com (Pass: CampusAdmin@2026)`);
  console.log(`   - harshal.admin@campuscrave.com  (Pass: CampusAdmin@2026)`);
  console.log(`   - admin@campuscrave.com          (Pass: CampusAdmin@2026)\n`);
  console.log(`   Staff:`);
  console.log(`   - roshni.staff@campuscrave.com   (Pass: CampusStaff@2026)`);
  console.log(`   - satish.staff@campuscrave.com   (Pass: CampusStaff@2026)`);
  console.log(`   - staff@campuscrave.com          (Pass: CampusStaff@2026)`);
  console.log("  ─────────────────────────────────────────────");
  console.log("   Users will be asked to change passwords on first sign-in.\n");
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
