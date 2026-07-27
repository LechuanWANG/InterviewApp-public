export type PublicSupabaseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
};

export const PUBLIC_SUPABASE_ENV_GLOBAL = "__INTERVIEW_APP_PUBLIC_SUPABASE_ENV__" as const;

export function getRuntimePublicSupabaseEnv(): PublicSupabaseEnv | null {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "",
  };
  return isCompletePublicSupabaseEnv(env) ? env : null;
}

export function readBrowserPublicSupabaseEnv(): PublicSupabaseEnv | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as Window & {
    [PUBLIC_SUPABASE_ENV_GLOBAL]?: unknown;
  };
  const value = browserWindow[PUBLIC_SUPABASE_ENV_GLOBAL];
  return isCompletePublicSupabaseEnv(value) ? value : null;
}

export function serializePublicSupabaseEnv(env: PublicSupabaseEnv): string {
  return JSON.stringify(env).replace(/</g, "\\u003c");
}

function isCompletePublicSupabaseEnv(value: unknown): value is PublicSupabaseEnv {
  if (!value || typeof value !== "object") return false;
  const env = value as Partial<PublicSupabaseEnv>;
  return (
    typeof env.NEXT_PUBLIC_SUPABASE_URL === "string" &&
    env.NEXT_PUBLIC_SUPABASE_URL.trim().length > 0 &&
    typeof env.NEXT_PUBLIC_SUPABASE_ANON_KEY === "string" &&
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim().length > 0
  );
}
