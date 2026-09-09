/**
 * The counter's till: what is open, what can be sold, what has been taken.
 *
 * Reads share `readStaffSales` with the web page. **Writes call the existing
 * Server Actions directly** rather than reimplementing them — the eight of them
 * carry the whole POS policy (merge-or-add a line, the double-finalise guard,
 * optimistic concurrency on payment, the audit rows), and a second copy in a
 * route handler is exactly the drift that ends in two tills disagreeing about a
 * bill.
 *
 * They take `FormData` because they are form actions; building one here is a
 * far smaller price than owning that logic twice. `getSessionUser` is
 * transport-aware, so each one authenticates the bearer caller unchanged.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addBillLine,
  cancelBill,
  createBill,
  finalizeBill,
  removeBillLine,
  renameBillPerson,
  setLineQuantity,
  toggleBillPayment,
} from "@/app/(app)/staff/sales/actions";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { readStaffSales } from "@/infra/queries/staff-sales";

const schema = z.object({
  action: z.enum([
    "createBill",
    "renameBillPerson",
    "addBillLine",
    "setLineQuantity",
    "removeBillLine",
    "finalizeBill",
    "cancelBill",
    "toggleBillPayment",
  ]),
  billId: z.string().uuid().optional(),
  fields: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});

function guard(role: string) {
  return role !== "STAFF" && role !== "ADMIN" && role !== "SUPER_ADMIN";
}

function forbidden() {
  return NextResponse.json(
    { error: { code: "FORBIDDEN", message: "Only counter staff can do this." } },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { user, supabase } = auth.caller;
  if (guard(user.role)) return forbidden();

  return NextResponse.json(await readStaffSales(supabase, user), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (guard(auth.caller.user.role)) return forbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Malformed request." } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Check the details." } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const form = new FormData();
  for (const [key, value] of Object.entries(parsed.data.fields)) {
    form.set(key, String(value));
  }

  const { action, billId } = parsed.data;

  // The four bill-scoped actions are curried on the id; the rest read it from
  // the form. Missing it is a client bug, not something to guess at.
  const needsBillId =
    action === "renameBillPerson" ||
    action === "finalizeBill" ||
    action === "cancelBill" ||
    action === "toggleBillPayment";

  if (needsBillId && !billId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Which bill?" } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await (async () => {
    switch (action) {
      case "createBill":
        return createBill({}, form);
      case "addBillLine":
        return addBillLine({}, form);
      case "setLineQuantity":
        return setLineQuantity({}, form);
      case "removeBillLine":
        return removeBillLine({}, form);
      case "renameBillPerson":
        return renameBillPerson(billId!, {}, form);
      case "finalizeBill":
        return finalizeBill(billId!, {}, form);
      case "cancelBill":
        return cancelBill(billId!, {}, form);
      case "toggleBillPayment":
        return toggleBillPayment(billId!, {}, form);
    }
  })();

  if (result.error) {
    // The action's message is written for the person at the counter — "Somebody
    // else just changed this. Reload the page." beats anything generic.
    return NextResponse.json(
      { error: { code: "CONFLICT", message: result.error } },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { message: result.success ?? null, billId: result.billId ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
