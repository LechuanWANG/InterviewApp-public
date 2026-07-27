"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AUTH_STATE_CHANGED_EVENT, type AuthStateChangedDetail } from "@/lib/authClientEvents";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { useI18n } from "./LanguageProvider";

type AppUser = {
  id: string;
  email?: string | null;
};

export default function AuthControl() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (active) setUser(json.user ?? null);

        try {
          const supabase = getSupabaseBrowserClient();
          const { data } = await supabase.auth.getSession();
          const accessToken = data.session?.access_token;
          if (accessToken && !json.user) {
            const syncRes = await fetch("/api/auth/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accessToken }),
            });
            const syncJson = await syncRes.json().catch(() => ({}));
            if (active && syncRes.ok) setUser(syncJson.user ?? null);
          }
        } catch {
          // Supabase public envs are required only when the user signs in.
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleAuthStateChanged(event: Event) {
      const detail = (event as CustomEvent<AuthStateChangedDetail>).detail;
      setUser(detail?.user ?? null);
      setLoading(false);
      setOpen(false);
    }

    window.addEventListener(AUTH_STATE_CHANGED_EVENT, handleAuthStateChanged);
    return () => {
      window.removeEventListener(AUTH_STATE_CHANGED_EVENT, handleAuthStateChanged);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function logout() {
    try {
      try {
        await getSupabaseBrowserClient().auth.signOut();
      } catch {
        // The server cookie is the authoritative app session for this app.
      }
      await fetch("/api/auth/session", { method: "DELETE" });
      setUser(null);
      window.location.assign("/?expanded=1");
    } catch {
      setUser(null);
    }
  }

  const avatarLabel = user?.email?.trim()?.[0]?.toUpperCase() || "U";

  // Only surfaced on the home page; every other screen keeps its own header.
  if (pathname !== "/") return null;

  return (
    <div className="fixed right-4 top-4 z-50">
      {loading ? (
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-xs text-slate-500 shadow-sm backdrop-blur">
          ...
        </div>
      ) : user ? (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur transition hover:bg-white"
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label={user.email || t("auth.loggedIn")}
          >
            {avatarLabel}
          </button>
          <div
            className={[
              "absolute right-0 top-11 w-56 rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs shadow-xl backdrop-blur transition",
              open
                ? "pointer-events-auto translate-y-0 opacity-100"
                : "pointer-events-none translate-y-1 opacity-0",
            ].join(" ")}
            role="menu"
          >
            <div className="mb-3 truncate text-slate-700">
              {user.email || t("auth.loggedIn")}
            </div>
            <button
              type="button"
              onClick={logout}
              className="w-full rounded-full bg-slate-900 px-3 py-2 font-medium text-white"
              role="menuitem"
            >
              {t("auth.logout")}
            </button>
          </div>
        </div>
      ) : (
        <Link
          href="/login"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:bg-white"
          aria-label={t("auth.login")}
        >
          {t("auth.login")}
        </Link>
      )}
    </div>
  );
}
