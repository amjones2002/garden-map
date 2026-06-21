import { config } from "dotenv";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import pg from "pg";

config({ path: ".env.local", quiet: true });

const url = process.env.SUPABASE_DB_URL;
if (!url || url.includes("PASTE_")) {
  console.error("SUPABASE_DB_URL not set in .env.local (Supabase → Connect → Direct connection → URI)");
  process.exit(1);
}

const only = process.argv[2]; // optional: a single migration filename
const dir = "supabase/migrations";

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const files = (only ? [only] : readdirSync(dir).filter((f) => f.endsWith(".sql")).sort());

await client.connect();
for (const f of files) {
  const sql = readFileSync(path.join(dir, f), "utf8");
  process.stdout.write(`applying ${f} … `);
  await client.query(sql);
  console.log("ok");
}
await client.end();
console.log("migrations applied");
