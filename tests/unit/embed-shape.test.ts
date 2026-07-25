/**
 * Regression tests for PostgREST embed shapes.
 *
 * These exist because of a real production bug: `getSessionUser` embedded
 * `students ( id )` on `profiles` and read `students[0].id`. PostgREST returns
 * that embed as an **object**, not an array, because `students.profile_id`
 * carries a UNIQUE constraint and the relationship is therefore one-to-one.
 * `students[0]` was `undefined`, so every student session had no `studentId`,
 * and the QR endpoint refused every student with FORBIDDEN.
 *
 * An `as unknown as Array<...>` cast hid it from the compiler. This helper and
 * these tests exist so the shape is handled once, deliberately, rather than
 * guessed at each call site.
 */
import { describe, expect, it } from "vitest";
import { firstRelated } from "@/infra/supabase/mappers";

describe("firstRelated", () => {
  it("unwraps a one-to-one embed, which PostgREST returns as an object", () => {
    // The exact shape that caused the bug: a unique FK collapses the embed.
    expect(firstRelated({ id: "student-1" })).toEqual({ id: "student-1" });
  });

  it("takes the first row of a one-to-many embed", () => {
    expect(firstRelated([{ id: "a" }, { id: "b" }])).toEqual({ id: "a" });
  });

  it("returns null for an empty array, not undefined", () => {
    expect(firstRelated([])).toBeNull();
  });

  it("returns null for null", () => {
    expect(firstRelated(null)).toBeNull();
  });

  it("returns null for undefined — a missing embed must not throw", () => {
    expect(firstRelated(undefined)).toBeNull();
  });

  it("survives the shape flipping if the unique constraint is ever dropped", () => {
    // Dropping students_profile_key would turn the object back into an array.
    // Both must keep working, or an unrelated migration silently breaks login.
    const asObject = firstRelated<{ id: string }>({ id: "x" });
    const asArray = firstRelated<{ id: string }>([{ id: "x" }]);
    expect(asObject?.id).toBe(asArray?.id);
  });
});
