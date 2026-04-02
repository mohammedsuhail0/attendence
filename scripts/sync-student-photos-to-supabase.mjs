import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_ENV_FILE = ".env.local";
const MANIFEST_CSV = "data/photo-extract/photo-enrollment-manifest.csv";
const STORAGE_BUCKET = "student-photos";
const STORAGE_PREFIX = "it24";

function loadEnv(file = DEFAULT_ENV_FILE) {
  const out = {};
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function parseCsv(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  const headers = lines[0].split(",");
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const obj = {};
    for (let i = 0; i < headers.length; i += 1) {
      obj[headers[i]] = cols[i] ?? "";
    }
    rows.push(obj);
  }
  return rows;
}

async function ensureBucket(supabase, bucketName) {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw new Error(`listBuckets failed: ${listErr.message}`);
  const exists = (buckets || []).some((b) => b.name === bucketName);
  if (exists) return false;

  const { error: createErr } = await supabase.storage.createBucket(bucketName, {
    public: false,
    fileSizeLimit: "5MB",
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  });
  if (createErr) throw new Error(`createBucket failed: ${createErr.message}`);
  return true;
}

async function main() {
  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }

  const manifestRows = parseCsv(MANIFEST_CSV);
  const mappedRows = manifestRows.filter((r) => r.status === "mapped");
  if (!mappedRows.length) {
    throw new Error(`No mapped rows found in ${MANIFEST_CSV}`);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: probeErr } = await supabase
    .from("profiles")
    .select("photo_path")
    .limit(1);
  if (probeErr && String(probeErr.message).includes("photo_path")) {
    throw new Error(
      "profiles.photo_path does not exist. Run supabase/profile-photo-migration.sql in Supabase SQL Editor first."
    );
  }

  const createdBucket = await ensureBucket(supabase, STORAGE_BUCKET);

  let uploaded = 0;
  let linked = 0;
  const failures = [];

  for (const row of mappedRows) {
    const roll = row.roll_number;
    const relativePath =
      row.mapped_face_path || path.posix.join("data/photo-extract/mapped/by_roll", `${roll}.png`);
    const absolutePath = path.resolve(relativePath);
    const objectPath = `${STORAGE_PREFIX}/${roll}.png`;

    try {
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`local photo missing: ${absolutePath}`);
      }

      const buffer = fs.readFileSync(absolutePath);
      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(objectPath, buffer, {
          upsert: true,
          contentType: "image/png",
          cacheControl: "3600",
        });
      if (uploadErr) {
        throw new Error(`upload failed: ${uploadErr.message}`);
      }
      uploaded += 1;

      const { data: updatedRows, error: updateErr } = await supabase
        .from("profiles")
        .update({ photo_path: objectPath })
        .eq("roll_number", roll)
        .select("id");

      if (updateErr) {
        if (String(updateErr.message).includes("photo_path")) {
          throw new Error(
            `photo_path column missing. Run supabase/profile-photo-migration.sql in SQL Editor first.`
          );
        }
        throw new Error(`profile update failed: ${updateErr.message}`);
      }

      const updatedCount = (updatedRows || []).length;
      if (updatedCount < 1) {
        throw new Error(`no profile matched roll_number ${roll}`);
      }

      linked += 1;
    } catch (err) {
      failures.push({
        roll_number: roll,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result = {
    bucket: STORAGE_BUCKET,
    bucket_created: createdBucket,
    attempted: mappedRows.length,
    uploaded,
    linked,
    failed: failures.length,
    failures,
  };

  console.log(JSON.stringify(result, null, 2));

  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
