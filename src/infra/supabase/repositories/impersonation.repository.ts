/**
 * Reads for "enter as this student".
 *
 * Service role, because the auth address behind a student's login lives in
 * `auth.users`, which no session client can read. That makes the tenant filter
 * in the statement load-bearing rather than a courtesy: with RLS bypassed it is
 * the only thing stopping a profile id from another mess resolving here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImpersonationDirectory } from "@/core/ports/repositories";
import type { ImpersonationCandidate } from "@/core/policies/operator-access.policy";
import type { ProfileStatus, UserRole } from "@/core/domain/enums";
import type { Database } from "../database.types";
import { firstRelated } from "../mappers";

export class SupabaseImpersonationDirectory implements ImpersonationDirectory {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  async findStudentAccount(
    tenantId: string,
    profileId: string,
  ): Promise<ImpersonationCandidate | null> {
    const { data, error } = await this.admin
      .from("profiles")
      .select("id, tenant_id, role, status, full_name, students ( roll_number )")
      .eq("tenant_id", tenantId)
      .eq("id", profileId)
      .maybeSingle();

    if (error) throw new Error(`impersonation lookup failed: ${error.message}`);
    if (!data) return null;

    // `students.profile_id` is unique, so PostgREST returns an object here, not
    // an array. firstRelated() reads either shape.
    const student = firstRelated<{ roll_number: string }>(data.students as never);

    return {
      profileId: data.id,
      tenantId: data.tenant_id,
      role: data.role as UserRole,
      profileStatus: data.status as ProfileStatus,
      fullName: data.full_name,
      rollNumber: student?.roll_number ?? null,
    };
  }

  /** The address the student signs in with — derived, never delivered to. */
  async authEmailOf(profileId: string): Promise<string | null> {
    const { data, error } = await this.admin.auth.admin.getUserById(profileId);
    if (error) throw new Error(`auth user lookup failed: ${error.message}`);
    return data.user?.email ?? null;
  }
}
