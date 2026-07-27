const requiredKeys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

const missing = requiredKeys.filter((key) => !process.env[key] || !String(process.env[key]).trim());

if (missing.length > 0) {
  console.error(`Missing public Supabase env vars: ${missing.join(", ")}`);
  process.exit(1);
}
