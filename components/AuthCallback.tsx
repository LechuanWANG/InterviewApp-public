"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { notifyAuthStateChanged } from "@/lib/authClientEvents";
import { sanitizeAuthNext } from "@/lib/authRedirect";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { useI18n } from "./LanguageProvider";
import LoadingIndicator from "./LoadingIndicator";

const REMEMBER_LOGIN_KEY = "interview-app-remember-login";
const AUTH_NEXT_KEY = "interview-app-auth-next";

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function completeLogin() {
      try {
        const supabase = getSupabaseBrowserClient();
        const code = searchParams.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error(t("auth.noSession"));
        const rememberParam = searchParams.get("remember");
        const remember =
          rememberParam === "0"
            ? false
            : rememberParam === "1"
              ? true
              : window.localStorage.getItem(REMEMBER_LOGIN_KEY) !== "0";
        const next = sanitizeAuthNext(
          searchParams.get("next") || window.localStorage.getItem(AUTH_NEXT_KEY)
        );

        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken, remember }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || t("auth.loginFailed"));
        notifyAuthStateChanged(json.user ?? null);

        if (!remember) {
          window.localStorage.removeItem(REMEMBER_LOGIN_KEY);
          await supabase.auth.signOut();
        }
        window.localStorage.removeItem(AUTH_NEXT_KEY);

        if (active) router.replace(next);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : t("auth.loginFailed"));
      }
    }

    completeLogin();
    return () => {
      active = false;
    };
  }, [router, searchParams, t]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-xl">
        {error ? error : <LoadingIndicator variant="inline" label={t("auth.completing")} />}
      </div>
    </main>
  );
}
