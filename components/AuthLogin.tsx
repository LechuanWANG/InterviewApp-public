"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { notifyAuthStateChanged, type AuthStateUser } from "@/lib/authClientEvents";
import { sanitizeAuthNext } from "@/lib/authRedirect";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { useI18n } from "./LanguageProvider";

const REMEMBER_LOGIN_KEY = "interview-app-remember-login";
const REMEMBER_EMAIL_KEY = "interview-app-remember-email";
const AUTH_NEXT_KEY = "interview-app-auth-next";
type OAuthProvider = "google" | "github";
type AuthMode = "login" | "register";
type SubmitStatus = "idle" | "submitting";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

export default function AuthLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const next = sanitizeAuthNext(searchParams.get("next"));

  useEffect(() => {
    const savedRemember = window.localStorage.getItem(REMEMBER_LOGIN_KEY);
    const shouldRemember = savedRemember !== "0";
    setRemember(shouldRemember);
    if (shouldRemember) {
      setEmail(window.localStorage.getItem(REMEMBER_EMAIL_KEY) || "");
    }
  }, []);

  function buildRedirectTo() {
    return `${window.location.origin}/auth/callback`;
  }

  function normalizedEmail() {
    return email.trim().toLowerCase();
  }

  function persistRememberChoice(loginEmail?: string) {
    if (remember) {
      window.localStorage.setItem(REMEMBER_LOGIN_KEY, "1");
      if (loginEmail) {
        window.localStorage.setItem(REMEMBER_EMAIL_KEY, loginEmail);
      }
    } else {
      window.localStorage.setItem(REMEMBER_LOGIN_KEY, "0");
      window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
    }
    window.localStorage.setItem(AUTH_NEXT_KEY, next);
  }

  function validateForm(loginEmail: string) {
    if (!EMAIL_PATTERN.test(loginEmail)) return t("auth.emailInvalid");
    if (!password) return t("auth.passwordRequired");
    if (mode === "register" && password.length < PASSWORD_MIN_LENGTH) {
      return t("auth.passwordTooShort", { count: PASSWORD_MIN_LENGTH });
    }
    if (mode === "register" && password !== confirmPassword) {
      return t("auth.passwordMismatch");
    }
    return null;
  }

  function getAuthErrorMessage(err: unknown, fallback = t("auth.loginFailed")) {
    const message = err instanceof Error ? err.message : "";
    if (/invalid login credentials/i.test(message)) {
      return t("auth.invalidCredentials");
    }
    return message || fallback;
  }

  async function syncAppSession(accessToken: string): Promise<AuthStateUser> {
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, remember }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || t("auth.loginFailed"));
    if (!json.user?.id) throw new Error(t("auth.noSession"));
    return json.user;
  }

  async function signInWithPassword(loginEmail: string): Promise<AuthStateUser> {
    const supabase = getSupabaseBrowserClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });
    if (signInError) throw signInError;

    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error(t("auth.noSession"));
    const appUser = await syncAppSession(accessToken);

    if (!remember) {
      await supabase.auth.signOut();
    }
    return appUser;
  }

  async function registerWithPassword(loginEmail: string) {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: loginEmail, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || t("auth.registerFailed"));
  }

  async function signInWithProvider(provider: OAuthProvider) {
    setError(null);
    setStatus("submitting");
    try {
      const supabase = getSupabaseBrowserClient();
      persistRememberChoice();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: buildRedirectTo() },
      });
      if (signInError) throw signInError;
    } catch (err) {
      setError(getAuthErrorMessage(err));
      setStatus("idle");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const loginEmail = normalizedEmail();
    const validationError = validateForm(loginEmail);
    if (validationError) {
      setError(validationError);
      return;
    }

    setStatus("submitting");
    try {
      persistRememberChoice(loginEmail);
      if (mode === "register") {
        await registerWithPassword(loginEmail);
      }
      const appUser = await signInWithPassword(loginEmail);
      notifyAuthStateChanged(appUser);
      window.localStorage.removeItem(AUTH_NEXT_KEY);
      router.replace(next);
    } catch (err) {
      if (!remember) {
        try {
          await getSupabaseBrowserClient().auth.signOut();
        } catch {
          // Ignore cleanup failures. The app cookie is only set after a successful sync.
        }
      }
      setError(getAuthErrorMessage(err));
      setStatus("idle");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6 py-10">
      <div className="w-full rounded-lg border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-6">
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
            {t("auth.kicker")}
          </div>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{t("auth.title")}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{t("auth.description")}</p>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1" role="tablist" aria-label={t("auth.mode")}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className={[
              "rounded-md px-3 py-2 text-sm font-medium transition",
              mode === "login" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900",
            ].join(" ")}
          >
            {t("auth.loginTab")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            className={[
              "rounded-md px-3 py-2 text-sm font-medium transition",
              mode === "register" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900",
            ].join(" ")}
          >
            {t("auth.registerTab")}
          </button>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">{t("auth.email")}</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-900"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">{t("auth.password")}</span>
            <input
              type="password"
              required
              minLength={mode === "register" ? PASSWORD_MIN_LENGTH : undefined}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("auth.passwordPlaceholder")}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-900"
            />
          </label>
          {mode === "register" && (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">{t("auth.confirmPassword")}</span>
              <input
                type="password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder={t("auth.confirmPasswordPlaceholder")}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-900"
              />
            </label>
          )}
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">{t("auth.remember")}</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                {t("auth.rememberDesc")}
              </span>
            </span>
          </label>
          <button
            type="submit"
            disabled={status === "submitting" || !email.trim() || !password}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {status === "submitting"
              ? mode === "login"
                ? t("auth.loggingIn")
                : t("auth.creatingAccount")
              : mode === "login"
                ? t("auth.signIn")
                : t("auth.signUp")}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700" role="alert">
            {error}
          </div>
        )}

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
            {t("auth.oauthDivider")}
          </span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <div className="space-y-3">
          <button
            type="button"
            disabled={status === "submitting"}
            onClick={() => signInWithProvider("google")}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            <span className="text-base font-semibold">G</span>
            {t("auth.signInWithGoogle")}
          </button>
          <button
            type="button"
            disabled={status === "submitting"}
            onClick={() => signInWithProvider("github")}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-900 bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            <span className="text-base">GH</span>
            {t("auth.signInWithGithub")}
          </button>
        </div>

        <Link
          href="/?expanded=1"
          className="mt-6 inline-flex text-sm font-medium text-slate-600 underline-offset-4 hover:underline"
        >
          {t("auth.backHome")}
        </Link>
      </div>
    </main>
  );
}
