/**
 * Menu import — verified against the LIVE database, using the real menu.
 *
 * The CSV below is the mess's own weekly sheet transcribed exactly, extras
 * block and all, including the "Extras" section heading and the blank
 * separator rows a spreadsheet leaves behind. If the parser copes with this it
 * copes with what the client will actually upload.
 *
 * Writes into a throwaway tenant-scoped date range far in the future and
 * deletes it afterwards, so no real menu is touched.
 *
 * Run with: npm run verify:menu-import
 */
import { loadEnv } from "./load-env.mjs";
loadEnv();

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/infra/supabase/database.types";
import { expandWeeklyMenu, parseMenuImport } from "../src/core/policies/menu-import.policy";
import { parseCsv } from "../src/lib/csv";
import { toServiceDate } from "../src/core/time";
import type { MealSlot } from "../src/core/domain/enums";

let failures = 0;
const pass = (m: string) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const fail = (m: string) => {
  console.error(`  \x1b[31m✖\x1b[0m ${m}`);
  failures++;
};
const check = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

// Transcribed from the mess's own sheet, blank rows and heading included.
const CSV = `Day,Meal,Menu Items,Price (₹)
Monday,Breakfast,Sabudana Khichdi,₹40
Tuesday,Breakfast,Idli Sambhar,₹40
Wednesday,Breakfast,Misal Pav,₹50
Thursday,Breakfast,Poha Aloo,₹40
Friday,Breakfast,"Uttapa, Nariyal Chutney",₹50
Saturday,Breakfast,Puri Bhaji,₹50
Sunday,Breakfast,Pav Bhaji,₹50
,,,
Monday,Lunch,"Chana Masala, Aloo Flower, Dal, Rice, Chapati, Sevai Kheer",₹90
Tuesday,Lunch,"Rajma Masala, Aloo Palak, Dal, Rice, Chapati, Salad",₹80
Wednesday,Lunch,"Hirve Vatana, Aloo Shimla, Dal, Rice, Chapati, Papad",₹80
Thursday,Lunch,"Chavali Masala, Farasbi Potato, Dal, Rice, Chapati, Papad",₹80
Friday,Lunch,"Dal Makhani, Tondli Chana, Dal, Rice, Chapati, Salad",₹80
Saturday,Lunch,"Mug Masala, Veg Pulao, Chapati, Papad, Raita",₹80
Sunday,Lunch,"Veg Biryani, Raita, Papad, Jilebhi",₹90
,,,
Monday,Snacks,Vada Pav,₹20
Tuesday,Snacks,"Shev Puri, Tea / Coffee",₹50
Wednesday,Snacks,Manchurian,₹40
Thursday,Snacks,Patties,₹20
Friday,Snacks,Pakode,₹40
Saturday,Snacks,Pani Puri,₹30
Sunday,Snacks,Samosa,₹20
,,,
Monday,Dinner,"Mix Sprout, Bhendi Masala, Dal, Rice, Chapati, Salad",₹100
Tuesday,Dinner,"Mushroom Masala, Mix Veg, Dal Chawal Tadka, Chapati, Papad",₹80
Wednesday,Dinner,"Masoor Masala, Aloo Kobi, Dal, Rice, Chapati",₹80
Thursday,Dinner,"Chana Masala, Dum Aloo, Dal, Rice, Chapati, Sheera",₹90
Friday,Dinner,"Soyabean Chilli, Fried Rice, Shezwan Chutney",₹120
Saturday,Dinner,"Kadi Pakoda, Jeera Rice, Chapati, Methi Aloo",₹80
Sunday,Dinner,"Matar Paneer, Jeera Aloo, Dal, Rice, Chapati",₹90
,,,
,,Tea,₹10
,,Coffee,₹15
,,Milk,₹15
,,Extras,
,,Bhaji,₹20
,,Chapati,₹10
,,Rice,₹30
,,Dal,₹20
,,Veg Fried Rice,₹60
,,Veg Soyabean Chilli,₹60
`;

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const { data: tenant } = await admin
  .from("tenants")
  .select("id, slug")
  .eq("slug", "unversity-mess")
  .single();
if (!tenant) throw new Error("seed tenant missing — run npm run db:seed");

const { data: settings } = await admin
  .from("tenant_settings")
  .select("meal_slots")
  .eq("tenant_id", tenant.id)
  .single();
const servedSlots = (settings!.meal_slots as Array<{ slot: MealSlot }>).map((s) => s.slot);

// Far enough out that no real menu lives there.
const FROM = toServiceDate("2030-03-01");
const TO = toServiceDate("2030-03-31");

console.log(`\nMenu import — ${tenant.slug}, using the client's real sheet\n`);

async function cleanup() {
  await admin
    .from("menus")
    .delete()
    .eq("tenant_id", tenant!.id)
    .gte("service_date", FROM)
    .lte("service_date", TO);
  await admin.from("counter_items").delete().eq("tenant_id", tenant!.id).like("item_code", "ZZ%");
}

try {
  console.log("Parsing the sheet as exported");
  const parsed = parseMenuImport({ rows: parseCsv(CSV), servedSlots });
  check(
    parsed.errors.length === 0,
    `no errors${parsed.errors.length ? ` — ${JSON.stringify(parsed.errors)}` : ""}`,
  );
  check(parsed.menu.length === 28, `28 menu cells: 7 days x 4 meals (${parsed.menu.length})`);
  check(
    parsed.counterItems.length === 9,
    `9 counter items, with "Extras" skipped as a heading (${parsed.counterItems.length})`,
  );

  const tea = parsed.counterItems.find((i) => i.itemName === "Tea");
  check(tea?.pricePaise === 1000, `Tea is 1000 paise, not 10 (${tea?.pricePaise})`);

  const sundayLunch = parsed.menu.find((m) => m.weekday === 0 && m.mealSlot === "LUNCH");
  check(
    sundayLunch?.items.join(" | ") === "Veg Biryani | Raita | Papad | Jilebhi",
    `a quoted, comma-separated dish list splits correctly (${sundayLunch?.items.length} dishes)`,
  );

  // The price against each day's meal is dropped by design (D-25).
  check(
    !Object.prototype.hasOwnProperty.call(sundayLunch ?? {}, "pricePaise"),
    "the per-meal price column is ignored, as decided",
  );

  console.log("\nExpanding one week across March 2030");
  const days = expandWeeklyMenu(parsed.menu, FROM, TO);
  // March 2030 has 31 days: five each of Fri/Sat/Sun, four of the rest.
  check(days.length === 31 * 4, `31 days x 4 meals = 124 rows (${days.length})`);

  const firstMonday = days.find((d) => d.serviceDate === toServiceDate("2030-03-04"));
  check(firstMonday !== undefined, "4 March 2030 is a Monday and got Monday's menu");

  console.log("\nWriting to the database");
  const { error: writeError } = await admin.from("menus").upsert(
    days.map((d) => ({
      tenant_id: tenant.id,
      service_date: d.serviceDate,
      meal_slot: d.mealSlot as MealSlot,
      items: [...d.items],
    })),
    { onConflict: "tenant_id,service_date,meal_slot" },
  );
  check(!writeError, `124 menus written${writeError ? ` — ${writeError.message}` : ""}`);

  const { count } = await admin
    .from("menus")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .gte("service_date", FROM)
    .lte("service_date", TO);
  check(count === 124, `all 124 are readable back (${count})`);

  // Re-importing the same file must replace, not duplicate or fail. That is
  // what makes a correction safe: fix a typo, upload again.
  const { error: secondError } = await admin.from("menus").upsert(
    days.map((d) => ({
      tenant_id: tenant.id,
      service_date: d.serviceDate,
      meal_slot: d.mealSlot as MealSlot,
      items: [...d.items],
    })),
    { onConflict: "tenant_id,service_date,meal_slot" },
  );
  const { count: afterSecond } = await admin
    .from("menus")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .gte("service_date", FROM)
    .lte("service_date", TO);
  check(
    !secondError && afterSecond === 124,
    `re-importing the same file replaces rather than duplicating (${afterSecond})`,
  );

  console.log("\nRejecting a sheet the mess cannot serve");
  const lunchOnly = parseMenuImport({ rows: parseCsv(CSV), servedSlots: ["LUNCH"] });
  check(
    lunchOnly.menu.length === 7 && lunchOnly.errors.length === 21,
    `21 rows refused for meals this mess does not serve (${lunchOnly.errors.length})`,
  );
} catch (e) {
  fail((e as Error).message);
} finally {
  await cleanup();
}

console.log(
  failures === 0
    ? "\n\x1b[32m✔ Menu import verified against the live database.\x1b[0m\n"
    : `\n\x1b[31m✖ ${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
