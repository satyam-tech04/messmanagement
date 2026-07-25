#!/usr/bin/env node
/**
 * Generates `src/lib/supabase/database.types.ts` by introspecting the live
 * database catalog.
 *
 * Why not `supabase gen types`? Its `--db-url` mode runs pg-meta inside Docker,
 * which this environment does not have, and its `--project-id` mode needs a
 * Supabase personal access token — a fifth credential to manage and rotate.
 * Introspecting the catalog directly needs neither, and the types are correct
 * by construction because they come from the same database the app talks to.
 *
 * Emits the shape `@supabase/supabase-js` expects for its `Database` generic:
 * per-table Row/Insert/Update, plus Enums. Insert marks a column optional when
 * it is nullable, has a default, or is generated — which is exactly when
 * PostgREST lets you omit it.
 *
 * Run after every `db:push`. Commit the result alongside the migration, so a
 * schema change that outruns the code surfaces as a type error.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";

const OUT = "src/lib/supabase/database.types.ts";

const client = new pg.Client({
  connectionString: execSync("node scripts/db-url.mjs", { encoding: "utf8" }).trim(),
});
await client.connect();

// --- Enums ----------------------------------------------------------------
const { rows: enumRows } = await client.query(`
  select t.typname as name, e.enumlabel as label
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public'
   order by t.typname, e.enumsortorder`);

const enums = new Map();
for (const { name, label } of enumRows) {
  if (!enums.has(name)) enums.set(name, []);
  enums.get(name).push(label);
}

// --- Columns --------------------------------------------------------------
// `format_type` gives the resolved SQL type; `attndims`/typcategory identify
// arrays; atthasdef plus identity/generated cover every "may be omitted" case.
const { rows: columns } = await client.query(`
  select c.relname                                as table_name,
         a.attname                                as column_name,
         a.attnum                                 as position,
         not a.attnotnull                         as is_nullable,
         (a.atthasdef or a.attidentity <> '' or a.attgenerated <> '') as has_default,
         format_type(a.atttypid, a.atttypmod)     as sql_type,
         coalesce(bt.typname, t.typname)          as base_type,
         (t.typcategory = 'A')                    as is_array,
         coalesce(bt.typtype, t.typtype)          as type_kind
    from pg_attribute a
    join pg_class c      on c.oid = a.attrelid
    join pg_namespace n  on n.oid = c.relnamespace
    join pg_type t       on t.oid = a.atttypid
    left join pg_type bt on bt.oid = t.typelem
   where n.nspname = 'public'
     and c.relkind = 'r'
     and a.attnum > 0
     and not a.attisdropped
   order by c.relname, a.attnum`);

await client.end();

/** Maps a Postgres base type to its TypeScript representation. */
function tsType(col) {
  if (col.type_kind === "e") return `Database["public"]["Enums"]["${col.base_type}"]`;

  switch (col.base_type) {
    case "uuid":
    case "text":
    case "varchar":
    case "bpchar":
    case "citext":
    case "inet":
    case "date": // plain calendar date, always YYYY-MM-DD (§2.9)
    case "timestamptz":
    case "timestamp":
    case "time":
    case "timetz":
      return "string";
    // int8/bigint is money in paise here and always fits in a JS safe integer
    // at realistic amounts, so `number` is correct and far easier to work with
    // than the string PostgREST would hand back for an arbitrary bigint.
    case "int2":
    case "int4":
    case "int8":
    case "float4":
    case "float8":
    case "numeric":
      return "number";
    case "bool":
      return "boolean";
    case "json":
    case "jsonb":
      return "Json";
    default:
      return "unknown";
  }
}

const byTable = new Map();
for (const col of columns) {
  if (!byTable.has(col.table_name)) byTable.set(col.table_name, []);
  byTable.get(col.table_name).push(col);
}

function renderTable(name, cols) {
  const row = cols
    .map((c) => {
      const base = tsType(c) + (c.is_array ? "[]" : "");
      return `        ${c.column_name}: ${base}${c.is_nullable ? " | null" : ""};`;
    })
    .join("\n");

  const insert = cols
    .map((c) => {
      const base = tsType(c) + (c.is_array ? "[]" : "");
      const optional = c.is_nullable || c.has_default;
      return `        ${c.column_name}${optional ? "?" : ""}: ${base}${
        c.is_nullable ? " | null" : ""
      };`;
    })
    .join("\n");

  const update = cols
    .map((c) => {
      const base = tsType(c) + (c.is_array ? "[]" : "");
      return `        ${c.column_name}?: ${base}${c.is_nullable ? " | null" : ""};`;
    })
    .join("\n");

  return `      ${name}: {
      Row: {
${row}
      };
      Insert: {
${insert}
      };
      Update: {
${update}
      };
      Relationships: [];
    };`;
}

const tablesBlock = [...byTable.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, cols]) => renderTable(name, cols))
  .join("\n");

const enumsBlock = [...enums.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, labels]) => `      ${name}: ${labels.map((l) => `"${l}"`).join(" | ")};`)
  .join("\n");

const output = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by \`npm run db:types\` (scripts/gen-types.mjs) from the live schema.
 * Regenerate and commit this in the same change as any migration, so that code
 * outrunning the database becomes a compile error instead of a runtime one.
 *
 * Generated against project: ${process.env.SUPABASE_PROJECT_REF ?? "unknown"}
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
${tablesBlock}
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
${enumsBlock}
    };
    CompositeTypes: Record<never, never>;
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
`;

mkdirSync("src/lib/supabase", { recursive: true });
writeFileSync(OUT, output);
console.log(`✔ ${OUT}: ${byTable.size} tables, ${enums.size} enums, ${columns.length} columns`);
