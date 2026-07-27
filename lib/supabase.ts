import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  // eslint-disable-next-line no-var
  var __supabase: SupabaseClient | undefined;
}

function getSupabase(): SupabaseClient {
  if (globalThis.__supabase) return globalThis.__supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
  }

  globalThis.__supabase = createClient(url, key);
  return globalThis.__supabase;
}

export function getSupabaseClient(): SupabaseClient {
  return getSupabase();
}
