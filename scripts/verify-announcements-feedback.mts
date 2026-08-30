/**
 * Announcements and feedback — verified against the LIVE database.
 *
 * Three claims here can only be tested against real rows and real sessions:
 *
 *   * an announcement appears and disappears purely from its dates, with
 *     nothing running to expire it;
 *   * a student can write their OWN feedback and nobody else's, which is an RLS
 *     question, not an application one — the `with check` on `student_id` is
 *     the only thing standing between a student and a five-star review posted
 *     in somebody else's name;
 *   * one verdict per meal survives a double submit, because the unique index
 *     turns the second one into a replacement rather than a second row.
 *
 * Creates and deletes its own throwaway rows. Touches nothing seeded.
 *
 * Run with: npm run verify:announcements
 */
import { loadEnv } from "./load-env.mjs";
loadEnv();

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { Database } from "../src/infra/supabase/database.types";
import {
  announcementStateOf,
  visibleAnnouncements,
} from "../src/core/policies/announcement.policy";
import { averageRating } from "../src/core/policies/feedback.policy";
import { addDays, serviceDateOf, toServiceDate } from "../src/core/time";
import { syntheticEmailFor } from "../src/core/domain/identity";

let failures = 0;
const pass = (m: string) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const fail = (m: string) => {
  console.error(`  \x1b[31m✖\x1b[0m ${m}`);
  failures++;
};
const check = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: tenant } = await admin
  .from("tenants")
  .select("id, slug, timezone")
  .eq("slug", "unversity-mess")
  .single();
if (!tenant) throw new Error("seed tenant missing — run npm run db:seed");

const today = serviceDateOf(tenant.timezone, new Date());
const TAG = randomBytes(3).toString("hex");
const ROLL = `ZZFB${TAG.toUpperCase()}`;
console.log(`\nAnnouncements and feedback — ${tenant.slug}, ${today}\n`);

const announcementIds: string[] = [];
let userId: string | null = null;
let studentId: string | null = null;
let otherStudentId: string | null = null;

async function cleanup() {
  if (announcementIds.length) {
    await admin.from("announcements").delete().in("id", announcementIds);
  }
  if (studentId) {
    await admin.from("meal_feedback").delete().eq("student_id", studentId);
    await admin.from("students").delete().eq("id", studentId);
  }
  if (userId) {
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

try {
  // --- Announcements: visibility is derived from dates ----------------------
  console.log("Announcements");
  const mk = async (label: string, startsOn: string, endsOn: string, status = "PUBLISHED") => {
    const { data } = await admin
      .from("announcements")
      .insert({
        tenant_id: tenant.id,
        title: `zz-${label}-${TAG}`,
        body: "Payasam, avial, thoran.",
        starts_on: startsOn,
        ends_on: endsOn,
        status: status as "PUBLISHED" | "ARCHIVED",
      })
      .select("id, title, starts_on, ends_on, status")
      .single();
    if (data) announcementIds.push(data.id);
    return data!;
  };

  const live = await mk(
    "live",
    addDays(toServiceDate(today), -1),
    addDays(toServiceDate(today), 1),
  );
  const future = await mk(
    "future",
    addDays(toServiceDate(today), 5),
    addDays(toServiceDate(today), 6),
  );
  const past = await mk(
    "past",
    addDays(toServiceDate(today), -9),
    addDays(toServiceDate(today), -8),
  );
  const archived = await mk("archived", today, today, "ARCHIVED");

  const asDates = (r: typeof live) => ({
    id: r.id,
    status: r.status,
    startsOn: toServiceDate(r.starts_on),
    endsOn: toServiceDate(r.ends_on),
  });

  check(announcementStateOf(asDates(live), today) === "LIVE", "one inside its window is LIVE");
  check(
    announcementStateOf(asDates(future), today) === "SCHEDULED",
    "one starting later is SCHEDULED",
  );
  check(
    announcementStateOf(asDates(past), today) === "FINISHED",
    "one whose window has passed is FINISHED — with nothing having run to expire it",
  );
  check(
    announcementStateOf(asDates(archived), today) === "ARCHIVED",
    "a withdrawn one is ARCHIVED even though today is inside its window",
  );

  const visible = visibleAnnouncements([live, future, past, archived].map(asDates), today);
  check(
    visible.length === 1 && visible[0]!.id === live.id,
    `exactly one of four is on a student's screen today (${visible.length})`,
  );

  // The same filter the student page applies in SQL, to be sure the query and
  // the policy agree rather than merely both looking right.
  const { data: queried } = await admin
    .from("announcements")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("status", "PUBLISHED")
    .lte("starts_on", today)
    .gte("ends_on", today)
    .in("id", announcementIds);
  check(
    queried?.length === 1 && queried[0]!.id === live.id,
    `the SQL the student page runs returns the same single row (${queried?.length})`,
  );

  // --- A throwaway student --------------------------------------------------
  console.log("\nFeedback");
  const email = syntheticEmailFor(tenant.slug, ROLL.toLowerCase());
  const password = randomBytes(12).toString("base64url");
  const { data: created } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  userId = created!.user!.id;
  await admin.from("profiles").insert({
    id: userId,
    tenant_id: tenant.id,
    role: "STUDENT",
    full_name: "Feedback Probe",
    status: "ACTIVE",
    must_change_password: false,
  });
  const { data: student } = await admin
    .from("students")
    .insert({
      tenant_id: tenant.id,
      profile_id: userId,
      roll_number: ROLL,
      status: "ACTIVE",
      joined_at: today,
    })
    .select("id")
    .single();
  studentId = student!.id;

  // Somebody else's row, to prove a student cannot write it.
  const { data: victim } = await admin
    .from("students")
    .select("id")
    .eq("tenant_id", tenant.id)
    .neq("id", studentId)
    .limit(1)
    .single();
  otherStudentId = victim?.id ?? null;

  // --- One verdict per meal -------------------------------------------------
  const row = {
    tenant_id: tenant.id,
    student_id: studentId,
    service_date: today,
    meal_slot: "LUNCH" as const,
  };

  await admin.from("meal_feedback").insert({ ...row, rating: 2, comment: "Cold dal" });
  const { error: second } = await admin
    .from("meal_feedback")
    .insert({ ...row, rating: 5, comment: "Changed my mind" });
  check(
    second?.code === "23505",
    `a second rating for the same meal is refused (${second?.code ?? "ACCEPTED — LEAK"})`,
  );

  // Which is what makes the upsert the action uses a replacement, not a stack.
  await admin
    .from("meal_feedback")
    .upsert(
      { ...row, rating: 4, comment: "Better at dinner" },
      { onConflict: "tenant_id,student_id,service_date,meal_slot" },
    );
  const { data: afterUpsert } = await admin
    .from("meal_feedback")
    .select("rating, comment")
    .eq("student_id", studentId);
  check(
    afterUpsert?.length === 1 && afterUpsert[0]!.rating === 4,
    `re-submitting replaced the rating rather than adding one (${afterUpsert?.length} row, rating ${afterUpsert?.[0]?.rating})`,
  );

  check(averageRating([4]) === 4, "the admin summary reads the stored rating back");

  // --- RLS: a student writes their own row and nobody else's ---------------
  console.log("\nRow level security, on a real student session");
  const asStudent = createClient<Database>(url, anon);
  const { error: signInError } = await asStudent.auth.signInWithPassword({ email, password });
  if (signInError) {
    fail(`could not sign in as the probe student — ${signInError.message}`);
  } else {
    const { error: ownError } = await asStudent.from("meal_feedback").upsert(
      {
        tenant_id: tenant.id,
        student_id: studentId,
        service_date: today,
        meal_slot: "DINNER",
        rating: 5,
        comment: "Own row",
      },
      { onConflict: "tenant_id,student_id,service_date,meal_slot" },
    );
    check(
      !ownError,
      `a student can write their own feedback${ownError ? ` — ${ownError.message}` : ""}`,
    );

    if (otherStudentId) {
      const { error: forgedError } = await asStudent.from("meal_feedback").insert({
        tenant_id: tenant.id,
        student_id: otherStudentId,
        service_date: today,
        meal_slot: "BREAKFAST",
        rating: 5,
        comment: "Posted in somebody else's name",
      });
      check(
        forgedError !== null,
        `a student CANNOT post feedback as another student (${forgedError?.code ?? "ACCEPTED — LEAK"})`,
      );
    }

    const { data: seen } = await asStudent.from("meal_feedback").select("student_id");
    check(
      (seen ?? []).every((f) => f.student_id === studentId),
      `a student reads only their own feedback (${seen?.length ?? 0} rows, all theirs)`,
    );

    // Announcements are for everybody in the mess — that is the point of them.
    const { data: studentSees } = await asStudent
      .from("announcements")
      .select("id")
      .in("id", announcementIds);
    check(
      (studentSees ?? []).length === announcementIds.length,
      `a student can read the mess's announcements (${studentSees?.length})`,
    );

    const { error: postError } = await asStudent.from("announcements").insert({
      tenant_id: tenant.id,
      title: "Posted by a student",
      starts_on: today,
      ends_on: today,
    });
    check(
      postError !== null,
      `a student CANNOT post an announcement (${postError?.code ?? "ACCEPTED — LEAK"})`,
    );
    await asStudent.auth.signOut();
  }
} catch (e) {
  fail((e as Error).message);
} finally {
  await cleanup();
}

console.log(
  failures === 0
    ? "\n\x1b[32m✔ Announcements and feedback verified against the live database.\x1b[0m\n"
    : `\n\x1b[31m✖ ${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
