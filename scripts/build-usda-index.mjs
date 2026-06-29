/**
 * Pre-processes data/usda-plants.txt into src/data/usda-index.json.
 *
 * Keeps only primary records (empty synonym symbol column) that have a
 * non-empty scientific name. Strips taxonomic author attribution from the
 * scientific name so it fills into the botanical-name field cleanly.
 * Output shape: Array<{ s: string, c: string, f: string }>
 *   s = scientific name (no author)
 *   c = common name (may be empty string)
 *   f = family (may be empty string)
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const src = resolve(root, "data/usda-plants.txt");
const dest = resolve(root, "src/data/usda-index.json");

mkdirSync(resolve(root, "src/data"), { recursive: true });

/** Parse one quoted-CSV line into fields. */
function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

const RANK_KEYWORDS = new Set(["var.", "subsp.", "f.", "ssp.", "subvar.", "fo."]);

/**
 * Strip taxonomic author from a scientific name with author string.
 *   "Abies balsamea (L.) Mill."            → "Abies balsamea"
 *   "Abies balsamea var. phanerolepis Fern" → "Abies balsamea var. phanerolepis"
 *   "Abronia alpina Brandegee"             → "Abronia alpina"
 */
function stripAuthor(nameWithAuthor) {
  const parenIdx = nameWithAuthor.indexOf("(");
  const base = parenIdx !== -1 ? nameWithAuthor.slice(0, parenIdx) : nameWithAuthor;
  const words = base.trim().split(/\s+/);
  const kept = [];
  let expectRankEpithet = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (i === 0 || i === 1) { kept.push(w); continue; }
    if (RANK_KEYWORDS.has(w.toLowerCase())) { kept.push(w); expectRankEpithet = true; continue; }
    if (expectRankEpithet) { kept.push(w); expectRankEpithet = false; continue; }
    break; // everything else is author
  }
  return kept.join(" ");
}

const text = readFileSync(src, "utf8");
const lines = text.split(/\r?\n/);

const results = [];
let skipped = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  const fields = parseCsvLine(line);
  // Columns: Symbol, Synonym Symbol, Scientific Name with Author, Common Name, Family
  const synonymSymbol = fields[1] ?? "";
  const sciWithAuthor = fields[2] ?? "";
  const commonName = fields[3] ?? "";
  const family = fields[4] ?? "";

  // Only primary records (synonym symbol is empty)
  if (synonymSymbol.trim() !== "") { skipped++; continue; }

  const scientific = stripAuthor(sciWithAuthor);
  if (!scientific) continue;

  results.push({ s: scientific, c: commonName.trim(), f: family.trim() });
}

writeFileSync(dest, JSON.stringify(results));
console.log(`Wrote ${results.length} primary entries to src/data/usda-index.json (skipped ${skipped} synonyms)`);
