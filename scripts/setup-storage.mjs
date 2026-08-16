import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

import { ZONE_PHOTOS_BUCKET as BUCKET } from "../src/lib/image-spec.mjs";

// Every write path stores a downscaled display copy (a few hundred KB), so this
// is a backstop: a regression that starts uploading originals fails loudly here
// instead of quietly refilling the bucket past the plan's storage allowance.
const FILE_SIZE_LIMIT = "2MB";

async function main() {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((b) => b.name === BUCKET)) {
    // Ensure it is public and holds the current size limit.
    await supabase.storage.updateBucket(BUCKET, { public: true, fileSizeLimit: FILE_SIZE_LIMIT });
    console.log(`Bucket "${BUCKET}" already exists — ensured public, limit ${FILE_SIZE_LIMIT}.`);
    return;
  }
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: FILE_SIZE_LIMIT,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic"],
  });
  if (error) throw error;
  console.log(`Created public bucket "${BUCKET}".`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
