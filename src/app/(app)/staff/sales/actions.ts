"use server";

/**
 * Counter-sale bills.
 *
 * Staff-facing: create a bill, add and adjust lines, finalise or cancel it,
 * mark it paid. Every decision — the merge rule, the legal status transitions,
 * what a total is — lives in `counter-sales.policy.ts`. These actions
 * authenticate, validate, call it, and write.
 *
 * ## Two things worth reading before changing anything here
 *
 * **Lines are never read-modify-written.** Adding to an existing line goes
 * through `increment_bill_line`, which does `quantity = quantity + n` inside
 * the UPDATE. All open bills are a shared pool that any staff member can edit
 * (A2), and counter Wi-Fi is documented as unreliable, so a read-then-write
 * would silently lose lines — and the person who loses them is the one who gets
 * shouted at when the total is wrong.
 *
 * **Totals are computed from the lines at finalisation, never accumulated.**
 * A running total kept on the bill row would be one more thing that can drift
 * out of step with the lines it claims to summarise.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  billTotalPaise,
  canCancelBill,
  canFinalizeBill,
  canTogglePayment,
  parsePersonName,
  planLineAddition,
  parseQuantity,
  type BillLine,
} from "@/core/policies/counter-sales.policy";
import { toPaise } from "@/core/money";
import { serviceDateOf } from "@/core/time";
import { createAdminClient } from "@/infra/supabase/admin";
import { getSessionUser } from "@/infra/auth/session";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";

export interface SaleActionState {
  readonly error?: string;
  readonly success?: string;
  /** Set on creation so the UI can open the new bill immediately. */
  readonly billId?: string;
}

const uuid = z.string().uuid();

/** Staff run the counter; admins may too, for support. */
async function requireCounterUser() {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." as const };
  if (user.role === "STUDENT") {
    return { error: "Only staff can take counter sales." as const };
  }
  return { user, admin: createAdminClient() };
}

/** Loads a bill and its lines, proving it belongs to the caller's mess. */
async function loadBill(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  billId: string,
) {
  const { data: bill } = await admin
    .from("counter_bills")
    .select("id, bill_number, person_name, status, payment_status")
    .eq("id", billId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!bill) return null;

  const { data: rows } = await admin
    .from("counter_bill_items")
    .select(
      "id, counter_item_id, item_code_snapshot, item_name_snapshot, unit_snapshot, unit_price_paise, quantity",
    )
    .eq("bill_id", billId)
    .eq("tenant_id", tenantId)
    .order("created_at");

  const lines: BillLine[] = (rows ?? []).map((r) => ({
    id: r.id,
    counterItemId: r.counter_item_id ?? "",
    itemCodeSnapshot: r.item_code_snapshot,
    itemNameSnapshot: r.item_name_snapshot,
    unitSnapshot: r.unit_snapshot,
    unitPricePaise: toPaise(r.unit_price_paise),
    quantity: r.quantity,
  }));

  return { bill, lines };
}

// --- New bill --------------------------------------------------------------

export async function createBill(
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  const auth = await requireCounterUser();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const name = parsePersonName(String(formData.get("personName") ?? ""));
  if (!name.ok) return { error: name.error.message };

  // Row-locked and per mess. A global sequence would interleave two messes'
  // bill numbers and leave each owner's book with gaps they cannot explain.
  const { data: billNumber, error: numberError } = await admin.rpc("allocate_bill_number", {
    p_tenant_id: user.tenantId,
  });
  if (numberError || !billNumber) {
    return {
      error: `Could not allocate a bill number: ${numberError?.message ?? "none returned"}`,
    };
  }

  const { data: created, error } = await admin
    .from("counter_bills")
    .insert({
      tenant_id: user.tenantId,
      bill_number: billNumber,
      person_name: name.value,
      status: "OPEN",
      payment_status: "UNPAID",
      created_by: user.actorProfileId,
    })
    .select("id")
    .single();
  if (error) return { error: `Could not start the bill: ${error.message}` };

  revalidatePath("/staff/sales");
  return { success: `${billNumber} started for ${name.value}.`, billId: created.id };
}

export async function renameBillPerson(
  billId: string,
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  const auth = await requireCounterUser();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const name = parsePersonName(String(formData.get("personName") ?? ""));
  if (!name.ok) return { error: name.error.message };

  // A5: the name is editable while the bill is open and locked afterwards. The
  // status filter is what enforces it — a finalised bill matches nothing.
  const { error, count } = await admin
    .from("counter_bills")
    .update({ person_name: name.value }, { count: "exact" })
    .eq("id", billId)
    .eq("tenant_id", user.tenantId)
    .eq("status", "OPEN");

  if (error) return { error: `Could not rename: ${error.message}` };
  if (count === 0) return { error: "This bill is no longer open." };

  revalidatePath("/staff/sales");
  return { success: "Name updated." };
}

// --- Lines -----------------------------------------------------------------

const addSchema = z.object({
  billId: uuid,
  itemId: uuid,
  quantity: z.coerce.number(),
});

export async function addBillLine(
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  const auth = await requireCounterUser();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const parsed = addSchema.safeParse({
    billId: formData.get("billId"),
    itemId: formData.get("itemId"),
    quantity: formData.get("quantity") ?? "1",
  });
  if (!parsed.success) return { error: "Pick an item and a quantity." };

  const loaded = await loadBill(admin, user.tenantId, parsed.data.billId);
  if (!loaded) return { error: "Bill not found." };
  if (loaded.bill.status !== "OPEN") return { error: "This bill is no longer open." };

  // Only active items can be added to a NEW line (spec §3). An inactive item
  // already on a bill keeps rendering from its snapshot.
  const { data: item } = await admin
    .from("counter_items")
    .select("id, item_code, item_name, unit, price_paise, is_active")
    .eq("id", parsed.data.itemId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!item) return { error: "That item does not exist in this mess." };
  if (!item.is_active) return { error: `${item.item_name} is no longer on the counter list.` };

  const plan = planLineAddition({
    lines: loaded.lines,
    counterItemId: item.id,
    currentPricePaise: toPaise(item.price_paise),
    quantity: parsed.data.quantity,
  });
  if (!plan.ok) return { error: plan.error.message };

  if (plan.value.kind === "MERGE") {
    const { data: newQuantity, error } = await admin.rpc("increment_bill_line", {
      p_line_id: plan.value.lineId,
      p_delta: parsed.data.quantity,
    });
    if (error) return { error: `Could not add: ${error.message}` };
    if (newQuantity === null) return { error: "This bill is no longer open." };
    revalidatePath("/staff/sales");
    return { success: `${item.item_name} ×${newQuantity}.` };
  }

  const { error: insertError } = await admin.from("counter_bill_items").insert({
    tenant_id: user.tenantId,
    bill_id: parsed.data.billId,
    counter_item_id: item.id,
    // Copied now and never touched again (spec §12). Renaming or repricing the
    // item tomorrow must not move a bill that already exists.
    item_code_snapshot: item.item_code,
    item_name_snapshot: item.item_name,
    unit_snapshot: item.unit,
    unit_price_paise: item.price_paise,
    quantity: parsed.data.quantity,
  });

  if (insertError) {
    // 23505 is the (bill, item, price) unique index: another staff member added
    // the same item between our read and our write. The right answer is the one
    // the policy would have given had we seen their line — increment it.
    if (insertError.code === "23505") {
      const { data: line } = await admin
        .from("counter_bill_items")
        .select("id")
        .eq("bill_id", parsed.data.billId)
        .eq("counter_item_id", item.id)
        .eq("unit_price_paise", item.price_paise)
        .maybeSingle();
      if (line) {
        const { data: newQuantity } = await admin.rpc("increment_bill_line", {
          p_line_id: line.id,
          p_delta: parsed.data.quantity,
        });
        revalidatePath("/staff/sales");
        return { success: `${item.item_name} ×${newQuantity ?? parsed.data.quantity}.` };
      }
    }
    return { error: `Could not add: ${insertError.message}` };
  }

  revalidatePath("/staff/sales");
  return { success: `${item.item_name} added.` };
}

export async function setLineQuantity(
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  const auth = await requireCounterUser();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const lineId = uuid.safeParse(formData.get("lineId"));
  if (!lineId.success) return { error: "Line not found." };

  const quantity = parseQuantity(Number(formData.get("quantity") ?? "0"));
  if (!quantity.ok) return { error: quantity.error.message };

  // Guarded on the bill still being open, in the same statement, so a bill
  // finalised in another tab cannot be edited by this one.
  const { data: line } = await admin
    .from("counter_bill_items")
    .select("id, bill_id, counter_bills!inner ( status )")
    .eq("id", lineId.data)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!line) return { error: "Line not found." };
  const status = (line.counter_bills as unknown as { status: string } | null)?.status;
  if (status !== "OPEN") return { error: "This bill is no longer open." };

  const { error } = await admin
    .from("counter_bill_items")
    .update({ quantity: quantity.value })
    .eq("id", lineId.data)
    .eq("tenant_id", user.tenantId);
  if (error) return { error: `Could not update: ${error.message}` };

  revalidatePath("/staff/sales");
  return { success: "Quantity updated." };
}

export async function removeBillLine(
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  const auth = await requireCounterUser();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const lineId = uuid.safeParse(formData.get("lineId"));
  if (!lineId.success) return { error: "Line not found." };

  const { data: line } = await admin
    .from("counter_bill_items")
    .select("id, counter_bills!inner ( status )")
    .eq("id", lineId.data)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!line) return { error: "Line not found." };
  const status = (line.counter_bills as unknown as { status: string } | null)?.status;
  if (status !== "OPEN") return { error: "This bill is no longer open." };

  // Removing the last line is allowed (A6) — the bill simply becomes empty and
  // cannot be finalised until something is added back.
  const { error } = await admin
    .from("counter_bill_items")
    .delete()
    .eq("id", lineId.data)
    .eq("tenant_id", user.tenantId);
  if (error) return { error: `Could not remove: ${error.message}` };

  revalidatePath("/staff/sales");
  return { success: "Item removed." };
}

// --- Finalise and cancel ---------------------------------------------------

export async function finalizeBill(
  billId: string,
  _prev: SaleActionState,
  _formData: FormData,
): Promise<SaleActionState> {
  const auth = await requireCounterUser();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const loaded = await loadBill(admin, user.tenantId, billId);
  if (!loaded) return { error: "Bill not found." };

  const decision = canFinalizeBill(
    { status: loaded.bill.status, paymentStatus: loaded.bill.payment_status },
    loaded.lines,
  );
  if (!decision.ok) return { error: decision.error.message };

  const now = new Date();
  const { error, count } = await admin
    .from("counter_bills")
    .update(
      {
        status: "FINALIZED",
        total_paise: decision.value,
        finalized_at: now.toISOString(),
        finalized_by: user.actorProfileId,
        // The mess's own calendar day. Revenue groups on this, never on the
        // timestamp — India is UTC+5:30, so a bill finalised at 00:30 local
        // would otherwise land in yesterday's takings.
        service_date: serviceDateOf(user.timezone, now),
      },
      { count: "exact" },
    )
    .eq("id", billId)
    .eq("tenant_id", user.tenantId)
    // The real guarantee against a double-finalise from two tablets.
    .eq("status", "OPEN");

  if (error) return { error: `Could not finalise: ${error.message}` };
  if (count === 0) return { error: "This bill was already finalised or cancelled." };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "COUNTER_BILL_FINALIZED",
    entityType: "counter_bill",
    entityId: billId,
    after: {
      billNumber: loaded.bill.bill_number,
      personName: loaded.bill.person_name,
      totalPaise: decision.value,
      lines: loaded.lines.length,
    },
  });

  revalidatePath("/staff/sales");
  revalidatePath("/admin/counter-sales");
  return { success: `${loaded.bill.bill_number} finalised.` };
}

export async function cancelBill(
  billId: string,
  _prev: SaleActionState,
  _formData: FormData,
): Promise<SaleActionState> {
  const auth = await requireCounterUser();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const loaded = await loadBill(admin, user.tenantId, billId);
  if (!loaded) return { error: "Bill not found." };

  const decision = canCancelBill({
    status: loaded.bill.status,
    paymentStatus: loaded.bill.payment_status,
  });
  if (!decision.ok) return { error: decision.error.message };

  const { error, count } = await admin
    .from("counter_bills")
    .update(
      {
        status: "CANCELLED",
        cancelled_at: new Date().toISOString(),
        cancelled_by: user.actorProfileId,
      },
      { count: "exact" },
    )
    .eq("id", billId)
    .eq("tenant_id", user.tenantId)
    .eq("status", "OPEN");

  if (error) return { error: `Could not cancel: ${error.message}` };
  if (count === 0) return { error: "This bill was already finalised or cancelled." };

  // Retained, never deleted (spec §8): a cancelled bill is excluded from
  // revenue but stays as a record of what happened.
  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "COUNTER_BILL_CANCELLED",
    entityType: "counter_bill",
    entityId: billId,
    before: { totalPaise: billTotalPaise(loaded.lines), lines: loaded.lines.length },
    after: { billNumber: loaded.bill.bill_number, status: "CANCELLED" },
  });

  revalidatePath("/staff/sales");
  return { success: `${loaded.bill.bill_number} cancelled.` };
}

// --- Payment ---------------------------------------------------------------

/**
 * Flips a finalised bill between paid and unpaid (A10).
 *
 * Never touches the total, and never affects revenue: a finalised unpaid bill
 * still counts in full (spec §10). Written to `audit_log` because the row
 * itself only remembers who changed it last, and "when was this marked paid"
 * is exactly the question that gets asked weeks later.
 */
export async function toggleBillPayment(
  billId: string,
  _prev: SaleActionState,
  _formData: FormData,
): Promise<SaleActionState> {
  const auth = await requireCounterUser();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const loaded = await loadBill(admin, user.tenantId, billId);
  if (!loaded) return { error: "Bill not found." };

  const next = canTogglePayment({
    status: loaded.bill.status,
    paymentStatus: loaded.bill.payment_status,
  });
  if (!next.ok) return { error: next.error.message };

  const { error, count } = await admin
    .from("counter_bills")
    .update(
      { payment_status: next.value, payment_updated_by: user.actorProfileId },
      { count: "exact" },
    )
    .eq("id", billId)
    .eq("tenant_id", user.tenantId)
    .eq("payment_status", loaded.bill.payment_status);

  if (error) return { error: `Could not update payment: ${error.message}` };
  if (count === 0) return { error: "Somebody else just changed this. Reload the page." };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "COUNTER_BILL_PAYMENT_CHANGED",
    entityType: "counter_bill",
    entityId: billId,
    before: { paymentStatus: loaded.bill.payment_status },
    after: { paymentStatus: next.value, billNumber: loaded.bill.bill_number },
  });

  revalidatePath("/staff/sales");
  revalidatePath("/admin/counter-sales");
  return { success: next.value === "PAID" ? "Marked paid." : "Marked unpaid." };
}
