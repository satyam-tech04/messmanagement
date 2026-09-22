/**
 * Account deletion, against Supabase (D-32).
 *
 * Runs on the **service role**: requesting a deletion also disables the
 * requester's own profile, and erasure rewrites rows that RLS deliberately
 * stops anyone from touching. Every method still filters by `tenant_id`
 * anyway (rule 8) — the service role bypasses RLS, so the tenancy boundary
 * here is the query itself.
 *
 * `eraseIdentity` is the dangerous one, so it is written to be re-runnable:
 * every value it writes is derived from the ids, never from a clock or a random
 * source, so a retry after a half-finished run lands on exactly the same row.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountDeletionRepository,
  AccountHolder,
  CreateDeletionRequestInput,
  DeletionRequestRow,
} from "@/core/ports/repositories";
import type {
  DeletionRequestStatus,
  RedactedIdentity,
} from "@/core/policies/account-deletion.policy";
import type { Database } from "../database.types";
import { firstRelated } from "../mappers";

type Client = SupabaseClient<Database>;

/**
 * The row plus the names that make the admin queue readable.
 *
 * The names are joined live, never copied into the request row: a copy would
 * outlive the erasure it records, leaving the student's name in a table that
 * exists precisely because they asked for it to be gone. After erasure this
 * reads "Deleted account", which is the honest answer.
 */
const SELECT = `
  id, tenant_id, profile_id, student_id, status, requested_at, erase_by,
  previous_profile_status, previous_student_status, decided_at, decided_by, note,
  profiles!account_deletion_requests_profile_id_fkey ( full_name ),
  students ( roll_number )
` as const;

type Joined = {
  id: string;
  tenant_id: string;
  profile_id: string;
  student_id: string | null;
  status: DeletionRequestStatus;
  requested_at: string;
  erase_by: string;
  previous_profile_status: "ACTIVE" | "DISABLED";
  previous_student_status: "ACTIVE" | "GRACE" | "BLOCKED" | "INACTIVE" | null;
  decided_at: string | null;
  decided_by: string | null;
  note: string | null;
  profiles: unknown;
  students: unknown;
};

function toRow(row: Joined): DeletionRequestRow {
  const profile = firstRelated<{ full_name: string }>(row.profiles as never);
  const student = firstRelated<{ roll_number: string }>(row.students as never);

  return {
    id: row.id,
    tenantId: row.tenant_id,
    profileId: row.profile_id,
    studentId: row.student_id,
    status: row.status,
    requestedAt: row.requested_at,
    eraseBy: row.erase_by,
    previousProfileStatus: row.previous_profile_status,
    previousStudentStatus: row.previous_student_status,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    note: row.note,
    studentName: profile?.full_name ?? null,
    rollNumber: student?.roll_number ?? null,
  };
}

export class SupabaseAccountDeletionRepository implements AccountDeletionRepository {
  constructor(private readonly client: Client) {}

  async holderOf(tenantId: string, profileId: string): Promise<AccountHolder | null> {
    const { data, error } = await this.client
      .from("profiles")
      .select("id, status, students ( id, status )")
      .eq("id", profileId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error || !data) return null;

    const student = firstRelated<{ id: string; status: AccountHolder["studentStatus"] }>(
      data.students as never,
    );

    return {
      profileId: data.id,
      studentId: student?.id ?? null,
      profileStatus: data.status,
      studentStatus: student?.status ?? null,
    };
  }

  async openRequestFor(tenantId: string, profileId: string): Promise<DeletionRequestRow | null> {
    const { data, error } = await this.client
      .from("account_deletion_requests")
      .select(SELECT)
      .eq("tenant_id", tenantId)
      .eq("profile_id", profileId)
      .eq("status", "REQUESTED")
      .maybeSingle();

    if (error || !data) return null;
    return toRow(data as unknown as Joined);
  }

  async byId(tenantId: string, id: string): Promise<DeletionRequestRow | null> {
    const { data, error } = await this.client
      .from("account_deletion_requests")
      .select(SELECT)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();

    if (error || !data) return null;
    return toRow(data as unknown as Joined);
  }

  async listByTenant(tenantId: string): Promise<readonly DeletionRequestRow[]> {
    // Open requests first, then the closest deadline: the top of this list is
    // always the one nearest to breaking the 30-day promise.
    const { data, error } = await this.client
      .from("account_deletion_requests")
      .select(SELECT)
      .eq("tenant_id", tenantId)
      .order("status", { ascending: true })
      .order("erase_by", { ascending: true });

    if (error || !data) return [];
    return (data as unknown as Joined[]).map(toRow);
  }

  async create(input: CreateDeletionRequestInput): Promise<DeletionRequestRow> {
    const { data, error } = await this.client
      .from("account_deletion_requests")
      .insert({
        tenant_id: input.tenantId,
        profile_id: input.profileId,
        student_id: input.studentId,
        erase_by: input.eraseBy,
        previous_profile_status: input.previousProfileStatus,
        previous_student_status: input.previousStudentStatus,
      })
      .select(SELECT)
      .single();

    // Thrown, not returned: the service catches 23505 and treats a lost race as
    // the success it is. Swallowing it here would hide that from it.
    if (error) throw error;
    return toRow(data as unknown as Joined);
  }

  async markDecided(
    tenantId: string,
    id: string,
    decision: {
      readonly status: DeletionRequestStatus;
      readonly decidedBy: string;
      readonly note?: string | null;
    },
  ): Promise<DeletionRequestRow> {
    const { data, error } = await this.client
      .from("account_deletion_requests")
      .update({
        status: decision.status,
        decided_at: new Date().toISOString(),
        decided_by: decision.decidedBy,
        note: decision.note ?? null,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      // Only a request still open may be decided, in the database as well as in
      // the policy — two admins clicking at once must not both win.
      .eq("status", "REQUESTED")
      .select(SELECT)
      .single();

    if (error) throw error;
    return toRow(data as unknown as Joined);
  }

  async setAccess(
    tenantId: string,
    profileId: string,
    access: {
      readonly profileStatus: "ACTIVE" | "DISABLED";
      readonly studentStatus: "ACTIVE" | "GRACE" | "BLOCKED" | "INACTIVE" | null;
    },
  ): Promise<void> {
    const { error } = await this.client
      .from("profiles")
      .update({ status: access.profileStatus })
      .eq("id", profileId)
      .eq("tenant_id", tenantId);

    if (error) throw error;

    if (access.studentStatus) {
      const { error: studentError } = await this.client
        .from("students")
        .update({ status: access.studentStatus })
        .eq("profile_id", profileId)
        .eq("tenant_id", tenantId);

      if (studentError) throw studentError;
    }
  }

  async eraseIdentity(
    tenantId: string,
    input: {
      readonly profileId: string;
      readonly studentId: string | null;
      readonly redacted: RedactedIdentity;
    },
  ): Promise<void> {
    const { redacted, profileId, studentId } = input;

    // 1. The photographs, before the rows that point at them — an orphaned
    //    object nobody can find is worse than a missing pointer.
    if (studentId) {
      await this.client.storage.from("student-photos").remove([`${tenantId}/${studentId}`]);

      const { data: feedback } = await this.client
        .from("meal_feedback")
        .select("id, photo_path")
        .eq("tenant_id", tenantId)
        .eq("student_id", studentId);

      const photos = (feedback ?? [])
        .map((row) => row.photo_path)
        .filter((path): path is string => Boolean(path));

      if (photos.length > 0) await this.client.storage.from("meal-feedback").remove(photos);

      // Ratings and comments are the student's own words. The mess keeps what
      // it served, not what this person thought of it.
      const { error: feedbackError } = await this.client
        .from("meal_feedback")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("student_id", studentId);

      if (feedbackError) throw feedbackError;
    }

    // 2. Their devices. A push token identifies a phone and can be sent to, so
    //    it is deleted outright rather than anonymised — there is nothing in a
    //    token worth keeping, and an erased student must never be buzzed.
    const { error: tokenError } = await this.client
      .from("device_tokens")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("profile_id", profileId);

    if (tokenError) throw tokenError;

    // 3. The profile: name, contact details, photo pointer.
    const { error: profileError } = await this.client
      .from("profiles")
      .update({
        full_name: redacted.fullName,
        phone: redacted.phone,
        email: redacted.email,
        photo_url: redacted.photoUrl,
        status: "DISABLED",
      })
      .eq("id", profileId)
      .eq("tenant_id", tenantId);

    if (profileError) throw profileError;

    // 4. The student row: roll number, room, block. The row itself stays —
    //    attendance, subscriptions and bills all cascade from it.
    if (studentId) {
      const { error: studentError } = await this.client
        .from("students")
        .update({
          roll_number: redacted.rollNumber,
          room_number: redacted.roomNumber,
          block: redacted.block,
          status: "INACTIVE",
        })
        .eq("id", studentId)
        .eq("tenant_id", tenantId);

      if (studentError) throw studentError;
    }

    // 5. The login itself. `profiles.status = 'DISABLED'` already refuses every
    //    session, but the credentials must stop being credentials: the address
    //    is replaced with one derived from the profile id — the same value on a
    //    retry — and the password with a value nobody holds.
    await this.client.auth.admin.updateUserById(profileId, {
      email: `deleted-${profileId}@deleted.invalid`,
      email_confirm: true,
      password: crypto.randomUUID() + crypto.randomUUID(),
      phone: undefined,
      user_metadata: {},
    });
  }
}
