#!/usr/bin/env node
// Guards against database.types.ts drifting from the real schema — the class of
// bug we kept hand-patching. Compares every public table column in the DB against
// the committed types file. Exits non-zero (listing gaps) if any column is
// missing. Run: node scripts/check-types-sync.mjs  (needs the local Supabase DB).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CONTAINER = process.env.SUPA_DB_CONTAINER || "supabase_db_InventorySystem";
const TYPES = "src/lib/supabase/database.types.ts";

function dbColumns() {
  const sql =
    "select table_name || ':::' || column_name from information_schema.columns " +
    "where table_schema='public' order by table_name, column_name;";
  const out = execSync(
    `docker exec -i ${CONTAINER} psql -U postgres -d postgres -t -A -c "${sql}"`,
    { encoding: "utf8" },
  );
  const map = new Map();
  for (const line of out.split("\n")) {
    const [t, c] = line.split(":::");
    if (!t || !c) continue;
    if (!map.has(t)) map.set(t, new Set());
    map.get(t).add(c);
  }
  return map;
}

// Extract each table's Row column names from the types file.
function typesColumns() {
  const src = readFileSync(TYPES, "utf8");
  const map = new Map();
  const tableRe = /^ {6}([a-z_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/gm;
  let m;
  while ((m = tableRe.exec(src))) {
    const table = m[1];
    const cols = new Set();
    for (const line of m[2].split("\n")) {
      const cm = line.match(/^ {10}([a-z_]+)\??:/);
      if (cm) cols.add(cm[1]);
    }
    map.set(table, cols);
  }
  return map;
}

const db = dbColumns();
const types = typesColumns();
const gaps = [];
for (const [table, cols] of db) {
  const t = types.get(table);
  if (!t) { gaps.push(`  table missing from types: ${table}`); continue; }
  for (const c of cols) if (!t.has(c)) gaps.push(`  ${table}.${c} — in DB, missing from types`);
}

if (gaps.length) {
  console.error(`✗ database.types.ts is out of sync with the schema:\n${gaps.join("\n")}`);
  console.error("\nRegenerate with `supabase gen types` (or add the columns) and recommit.");
  process.exit(1);
}
console.log(`✓ database.types.ts covers all ${db.size} tables' columns.`);
