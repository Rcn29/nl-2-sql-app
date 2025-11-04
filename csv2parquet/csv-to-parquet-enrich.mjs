// csv-to-parquet-enrich.mjs
// Usage:
// node csv-to-parquet-enrich.mjs --in input.csv --out output.parquet --schema schema.json --map map-config.json
//
// map-config.json (single-sheet example):
// {
//   "xlsx": "./data-guide.xlsx",
//   "singleSheet": { "sheet": "Lookups", "fieldCol": "field_name", "keyCol": "code", "labelCol": "label" },
//   "columns": [
//     { "column": "police_force", "field": "police_force", "output": "police_force_label" },
//     { "column": "collision_severity", "field": "collision_severity", "output": "collision_severity_label" }
//   ]
// }
//
// (Optional) multi-sheet also supported side-by-side:
// { "sheets": { "Road Type": { "key": "code", "value": "label" } },
//   "columns": [{ "column": "road_type", "sheet": "Road Type", "output": "road_type_label" }] }

import parquet from 'parquetjs-lite';
import csv from 'csv-parser';
import xlsx from 'xlsx';
import fs from 'node:fs';
import { resolve, dirname } from 'node:path';

// ---------------- CLI ----------------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.replace(/^--/, ''), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, [])
);

const inPath = resolve(args.in || args.input || '');
const outPath = resolve(args.out || args.output || '');
const schemaPath = resolve(args.schema || './schema.json');
const mapPath = resolve(args.map || './map-config.json');

if (!inPath || !outPath) {
  console.error('Usage: node csv-to-parquet-enrich.mjs --in input.csv --out output.parquet --schema schema.json --map map-config.json');
  process.exit(1);
}
if (!fs.existsSync(inPath)) { console.error('❌ Missing input CSV:', inPath); process.exit(1); }
if (!fs.existsSync(schemaPath)) { console.error('❌ Missing schema.json:', schemaPath); process.exit(1); }
if (!fs.existsSync(mapPath)) { console.error('❌ Missing map-config.json:', mapPath); process.exit(1); }
fs.mkdirSync(dirname(outPath), { recursive: true });

// ---------------- Load schema ----------------
const schemaJSON = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
if (!schemaJSON?.fields || typeof schemaJSON.fields !== 'object') {
  console.error('❌ schema.json must be: { "fields": { "<name>": { "type": "...", "optional": true } } }');
  process.exit(1);
}
const parquetFields = {};
for (const [name, def] of Object.entries(schemaJSON.fields)) {
  if (!def?.type) { console.error(`❌ Field "${name}" missing "type"`); process.exit(1); }
  parquetFields[name] = { type: def.type, optional: def.optional !== false };
}
const schema = new parquet.ParquetSchema(parquetFields);

// ---------------- Load mappings (single-sheet + multi-sheet) ----------------
const cfg = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const wb = xlsx.readFile(resolve(cfg.xlsx));
const sheetMaps = {};     // multi-sheet: sheetName -> Map(code -> label)
const fieldCodeMaps = {}; // single-sheet: fieldName -> Map(code -> label)

// A) Multi-sheet (optional)
if (cfg.sheets) {
  for (const [sheetName, spec] of Object.entries(cfg.sheets)) {
    const ws = wb.Sheets[sheetName];
    if (!ws) throw new Error(`Sheet not found: ${sheetName}`);
    const rows = xlsx.utils.sheet_to_json(ws, { defval: null });
    const map = new Map();
    for (const r of rows) {
      const k = r[spec.key];
      const v = r[spec.value];
      if (k != null) map.set(String(k), v == null ? null : String(v));
    }
    sheetMaps[sheetName] = map;
  }
}

// B) Single-sheet (field_name + code + label)
if (cfg.singleSheet) {
  const { sheet, fieldCol, keyCol, labelCol } = cfg.singleSheet;
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`Sheet not found: ${sheet}`);
  const rows = xlsx.utils.sheet_to_json(ws, { defval: null });
  for (const r of rows) {
    const field = r[fieldCol];
    const code  = r[keyCol];
    const label = r[labelCol];
    if (field == null || code == null) continue;
    const f = String(field);
    if (!fieldCodeMaps[f]) fieldCodeMaps[f] = new Map();
    fieldCodeMaps[f].set(String(code), label == null ? null : String(label));
  }
}

// ---------------- Helpers ----------------
const isBlank = v => v === '' || v == null;
const asInt = v => (/^-?\d+$/.test(v) ? Number(v) : null);
const asNum = v => (/^-?\d*(\.\d+)?([eE][+-]?\d+)?$/.test(v) && !/^[-+]?$/.test(v) ? Number(v) : null);

function coerce(value, def) {
  if (isBlank(value)) return null;
  const v = String(value).trim();
  switch (def.type) {
    case 'BOOLEAN': return /^(true|1|yes|y)$/i.test(v) ? true : /^(false|0|no|n)$/i.test(v) ? false : null;
    case 'INT32':   return asInt(v);
    case 'INT64':   return asInt(v); // ⚠ JS cannot precisely hold > 2^53-1; use UTF8 if you expect huge ints
    case 'FLOAT':
    case 'DOUBLE':  return asNum(v);
    case 'TIMESTAMP_MILLIS': {
      const d = new Date(v);
      return Number.isNaN(d.valueOf()) ? null : d;
    }
    case 'UTF8':
    default:        return v;
  }
}

function applyMappings(outRow) {
  for (const rule of cfg.columns || []) {
    let label = null;

    // Multi-sheet mapping (by sheet name)
    if (rule.sheet && sheetMaps[rule.sheet]) {
      const m = sheetMaps[rule.sheet];
      label = m.get(String(outRow[rule.column]));
    }

    // Single-sheet mapping (by field name)
    if (rule.field && fieldCodeMaps[rule.field]) {
      const m = fieldCodeMaps[rule.field];
      label = m.get(String(outRow[rule.column]));
    }

    if (rule.replace) {
      // replace the code with label in the same column
      outRow[rule.column] = label ?? outRow[rule.column];
    } else if (rule.output) {
      // write to a separate *_label column
      outRow[rule.output] = label ?? null;
    }
  }
}

// ---------------- Convert ----------------
async function writeParquet() {
  const writer = await parquet.ParquetWriter.openFile(schema, outPath);
  let count = 0;

  const stream = fs.createReadStream(inPath).pipe(csv());
  for await (const row of stream) {
    const outRow = {};
    // Set all schema fields; label fields start as null (will be filled by mappings)
    for (const [name, def] of Object.entries(schemaJSON.fields)) {
      if (name.endsWith('_label')) { outRow[name] = null; continue; }
      outRow[name] = coerce(row[name], def);
    }
    // Fill labels
    applyMappings(outRow);

    await writer.appendRow(outRow);
    count++;
  }
  await writer.close();
  return count;
}

// ---------------- Run ----------------
console.log('Input :', inPath);
console.log('Output:', outPath);
console.log('Schema:', schemaPath);
console.log('Map   :', mapPath);

writeParquet()
  .then(n => console.log(`✅ Done. Rows written: ${n}`))
  .catch(e => { console.error('❌ Failed:', e?.message || e); process.exit(1); });
