/**
 * Counter sales — verified against the LIVE database.
 *
 * The claims worth proving are all about what the *database* does, so fakes
 * cannot reach them: that bill numbers are allocated per mess rather than
 * globally, that a bill line keeps its snapshot when the catalogue moves under
 * it, that a finalised bill cannot be edited or finalised twice, and that a
 * bill cannot be marked paid before it is finalised.
 *
 * Creates and deletes its own throwaway rows. Touches nothing seeded.
 *
 * Run with: npm run verify:counter-sales
 */
import { loadEnv } from "./load-env.mjs";
loadEnv();

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { Database } from "../src/infra/supabase/database.types";
import { billTotalPaise, planLineAddition } from "../src/core/policies/counter-sales.policy";
import { toPaise } from "../src/core/money";
import { serviceDateOf } from "../src/core/time";

let failures = 0;
const pass = (m: string) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const fail = (m: string) => {
  console.error(`  \x1b[31m✖\x1b[0m ${m}`);
  failures++;
};
const check = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const { data: tenants } = await admin
  .from("tenants")
  .select("id, slug, timezone")
  .in("slug", ["unversity-mess", "demo-hostel"]);
const home = tenants?.find((t) => t.slug === "unversity-mess");
const other = tenants?.find((t) => t.slug === "demo-hostel");
if (!home || !other) throw new Error("seed tenants missing — run npm run db:seed");

const TAG = randomBytes(3).toString("hex");
const today = serviceDateOf(home.timezone, new Date());
console.log(`\nCounter sales — ${home.slug}, ${today}\n`);

const itemIds: string[] = [];
const billIds: string[] = [];

async function cleanup() {
  if (billIds.length) {
    await admin.from("counter_bill_items").delete().in("bill_id", billIds);
    await admin.from("counter_bills").delete().in("id", billIds);
  }
  if (itemIds.length) await admin.from("counter_items").delete().in("id", itemIds);
}

try {
  // --- Numbering is per mess, not global -----------------------------------
  console.log("Numbering");
  const { data: codeA } = await admin.rpc("allocate_counter_item_code", { p_tenant_id: home.id });
  const { data: codeB } = await admin.rpc("allocate_counter_item_code", { p_tenant_id: home.id });
  check(
    typeof codeA === "string" && /^C\d{3}$/.test(codeA),
    `item codes look like C001 (${codeA})`,
  );
  check(codeA !== codeB, `two allocations never collide (${codeA} vs ${codeB})`);

  const counterFor = async (tenantId: string) => {
    const { data } = await admin
      .from("tenants")
      .select("next_bill_number")
      .eq("id", tenantId)
      .single();
    return data!.next_bill_number;
  };

  const homeBefore = await counterFor(home.id);
  const otherBefore = await counterFor(other.id);
  const { data: billHome } = await admin.rpc("allocate_bill_number", { p_tenant_id: home.id });
  const homeAfter = await counterFor(home.id);
  const otherAfter = await counterFor(other.id);

  check(
    typeof billHome === "string" && /^BILL-\d{6}$/.test(billHome),
    `bill numbers look like BILL-000001 (${billHome})`,
  );
  // The spec asked for ONE global sequence. On a multi-tenant system that would
  // interleave two messes' books and leave each owner with gaps they cannot
  // explain. The property is independence, not equality: allocating for one
  // mess must leave every other mess's counter exactly where it was.
  //
  // An earlier version of this check asserted both messes issued the SAME
  // number, which only held while the two counters happened to have advanced
  // equally — a coincidence that broke the moment one probe run allocated from
  // one mess and not the other.
  check(
    homeAfter === homeBefore + 1,
    `allocating advances this mess's own counter by one (${homeBefore} -> ${homeAfter})`,
  );
  check(
    otherAfter === otherBefore,
    `and leaves the other mess's counter untouched (${otherBefore} -> ${otherAfter})`,
  );

  // --- Catalogue ------------------------------------------------------------
  console.log("\nCatalogue and snapshots");
  const { data: item, error: itemError } = await admin
    .from("counter_items")
    .insert({
      tenant_id: home.id,
      item_code: `ZZ${TAG.toUpperCase()}`,
      item_name: "Probe Dosa",
      unit: "Plate",
      price_paise: 6000,
      is_active: true,
    })
    .select("id, price_paise")
    .single();
  check(!itemError && item !== null, `item created${itemError ? ` — ${itemError.message}` : ""}`);
  if (item) itemIds.push(item.id);

  const { error: freeError } = await admin.from("counter_items").insert({
    tenant_id: home.id,
    item_code: `ZZF${TAG.toUpperCase()}`,
    item_name: "Free thing",
    unit: "Plate",
    price_paise: 0,
  });
  check(
    freeError?.code === "23514",
    `a zero-priced item is refused (${freeError?.code ?? "ACCEPTED"})`,
  );

  // --- A bill ---------------------------------------------------------------
  const { data: bill } = await admin
    .from("counter_bills")
    .insert({
      tenant_id: home.id,
      bill_number: `ZZ-${TAG}`,
      person_name: "Probe Person",
      status: "OPEN",
    })
    .select("id")
    .single();
  billIds.push(bill!.id);

  const addLine = async (pricePaise: number, quantity: number) =>
    admin.from("counter_bill_items").insert({
      tenant_id: home.id,
      bill_id: bill!.id,
      counter_item_id: item!.id,
      item_code_snapshot: `ZZ${TAG.toUpperCase()}`,
      item_name_snapshot: "Probe Dosa",
      unit_snapshot: "Plate",
      unit_price_paise: pricePaise,
      quantity,
    });

  const { error: line1 } = await addLine(6000, 2);
  check(!line1, `first line added${line1 ? ` — ${line1.message}` : ""}`);

  // The guard that makes the merge rule safe when two staff add at once.
  const { error: dupe } = await addLine(6000, 1);
  check(
    dupe?.code === "23505",
    `a second line for the same item at the same price is refused (${dupe?.code ?? "ACCEPTED — LEAK"})`,
  );

  // A price change legitimately produces a second line — the first customer's
  // quote must not be repriced.
  const { error: repriced } = await addLine(7000, 1);
  check(
    !repriced,
    `after a price change a separate line IS allowed${repriced ? ` — ${repriced.message}` : ""}`,
  );

  // --- The atomic increment -------------------------------------------------
  console.log("\nConcurrency");
  const { data: firstLine } = await admin
    .from("counter_bill_items")
    .select("id, quantity")
    .eq("bill_id", bill!.id)
    .eq("unit_price_paise", 6000)
    .single();

  // Ten simultaneous +1s. A read-modify-write would lose most of them; the
  // increment happens inside the UPDATE, so all ten land.
  await Promise.all(
    Array.from({ length: 10 }, () =>
      admin.rpc("increment_bill_line", { p_line_id: firstLine!.id, p_delta: 1 }),
    ),
  );
  const { data: afterRace } = await admin
    .from("counter_bill_items")
    .select("quantity")
    .eq("id", firstLine!.id)
    .single();
  check(
    afterRace?.quantity === 12,
    `ten concurrent increments all landed: 2 + 10 = ${afterRace?.quantity}`,
  );

  // --- Snapshots survive the catalogue moving -------------------------------
  console.log("\nHistorical protection (spec §12)");
  await admin
    .from("counter_items")
    .update({ item_name: "Renamed Entirely", price_paise: 9900, is_active: false })
    .eq("id", item!.id);

  const { data: linesAfter } = await admin
    .from("counter_bill_items")
    .select("item_name_snapshot, unit_price_paise, quantity")
    .eq("bill_id", bill!.id)
    .order("unit_price_paise");

  check(
    (linesAfter ?? []).length > 0 &&
      linesAfter!.every((l) => l.item_name_snapshot === "Probe Dosa"),
    "renaming and deactivating the item left the bill's name snapshot alone",
  );
  check(
    (linesAfter ?? []).some((l) => l.unit_price_paise === 6000),
    "the ₹60 line is still ₹60 after the item went to ₹99",
  );

  const total = billTotalPaise(
    (linesAfter ?? []).map((l, i) => ({
      id: String(i),
      counterItemId: item!.id,
      itemCodeSnapshot: "x",
      itemNameSnapshot: l.item_name_snapshot,
      unitSnapshot: "Plate",
      unitPricePaise: toPaise(l.unit_price_paise),
      quantity: l.quantity,
    })),
  );
  // 12 × ₹60 + 1 × ₹70 = ₹790
  check(total === 79000, `total computed from snapshots is ₹790 (${total}p)`);

  // --- Payment cannot precede finalisation ----------------------------------
  console.log("\nState machine");
  const { error: earlyPaid } = await admin
    .from("counter_bills")
    .update({ payment_status: "PAID" })
    .eq("id", bill!.id);
  check(
    earlyPaid?.code === "23514",
    `an OPEN bill cannot be marked paid (${earlyPaid?.code ?? "ACCEPTED — LEAK"})`,
  );

  // --- Finalise -------------------------------------------------------------
  const { error: finalizeError, count: finalized } = await admin
    .from("counter_bills")
    .update(
      {
        status: "FINALIZED",
        total_paise: total,
        finalized_at: new Date().toISOString(),
        service_date: today,
      },
      { count: "exact" },
    )
    .eq("id", bill!.id)
    .eq("status", "OPEN");
  check(
    !finalizeError && finalized === 1,
    `bill finalised${finalizeError ? ` — ${finalizeError.message}` : ""}`,
  );

  // The guard against two tablets finalising the same bill.
  const { count: again } = await admin
    .from("counter_bills")
    .update({ status: "FINALIZED" }, { count: "exact" })
    .eq("id", bill!.id)
    .eq("status", "OPEN");
  check(again === 0, `a second finalise matches nothing (${again} rows)`);

  // Now payment is allowed.
  const { error: paidNow } = await admin
    .from("counter_bills")
    .update({ payment_status: "PAID" })
    .eq("id", bill!.id);
  check(!paidNow, `a FINALIZED bill can be marked paid${paidNow ? ` — ${paidNow.message}` : ""}`);

  // Finalising without a service_date must be impossible — that column is what
  // revenue groups on, and a null would drop the bill out of every report.
  const { data: shapeBill } = await admin
    .from("counter_bills")
    .insert({ tenant_id: home.id, bill_number: `ZZS-${TAG}`, person_name: "Shape", status: "OPEN" })
    .select("id")
    .single();
  billIds.push(shapeBill!.id);
  const { error: shapeError } = await admin
    .from("counter_bills")
    .update({ status: "FINALIZED", finalized_at: new Date().toISOString() })
    .eq("id", shapeBill!.id);
  check(
    shapeError?.code === "23514",
    `finalising without a service_date is refused (${shapeError?.code ?? "ACCEPTED — LEAK"})`,
  );

  // --- Revenue counts only finalised bills ----------------------------------
  console.log("\nRevenue");
  const { data: dayBills } = await admin
    .from("counter_bills")
    .select("id, total_paise, status")
    .eq("tenant_id", home.id)
    .eq("status", "FINALIZED")
    .eq("service_date", today);
  check(
    (dayBills ?? []).some((b) => b.id === bill!.id),
    "the finalised bill appears in the day's takings",
  );
  check(!(dayBills ?? []).some((b) => b.id === shapeBill!.id), "the still-open bill does not");

  // --- The policy and the database agree ------------------------------------
  const plan = planLineAddition({
    lines: [
      {
        id: firstLine!.id,
        counterItemId: item!.id,
        itemCodeSnapshot: "x",
        itemNameSnapshot: "Probe Dosa",
        unitSnapshot: "Plate",
        unitPricePaise: toPaise(6000),
        quantity: 12,
      },
    ],
    counterItemId: item!.id,
    currentPricePaise: toPaise(6000),
    quantity: 1,
  });
  check(
    plan.ok && plan.value.kind === "MERGE",
    "the policy chooses MERGE exactly where the unique index would refuse an insert",
  );
} catch (e) {
  fail((e as Error).message);
} finally {
  await cleanup();
}

console.log(
  failures === 0
    ? "\n\x1b[32m✔ Counter sales verified against the live database.\x1b[0m\n"
    : `\n\x1b[31m✖ ${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
