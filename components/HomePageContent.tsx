"use client";

import Link from "next/link";
import { type FocusEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/LanguageProvider";
import HomeBackdrop, { type HomeBackdropMode } from "@/components/HomeBackdrop";

export default function HomePageContent() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [hoverMode, setHoverMode] = useState<HomeBackdropMode>("idle");
  const zoneRef = useRef<HTMLElement>(null);
  const hoverArmedRef = useRef(false);

  useEffect(() => {
    if (
      searchParams.get("expanded") === "1" ||
      sessionStorage.getItem("home-expanded") === "1"
    ) {
      setExpanded(true);
    }
  }, [searchParams]);

  // When the cards appear (on expand, or on back-navigation), one can land under
  // a resting cursor. Require a real pointer move before pointer-hover triggers
  // the word animation, so it never fires on its own. Keyboard focus still does.
  useEffect(() => {
    if (!expanded) return;
    hoverArmedRef.current = false;
    const arm = () => {
      hoverArmedRef.current = true;
    };
    window.addEventListener("pointermove", arm, { once: true });
    return () => window.removeEventListener("pointermove", arm);
  }, [expanded]);

  function setCardHover(mode: HomeBackdropMode, viaPointer = true) {
    if (mode !== "idle") {
      if (viaPointer && !hoverArmedRef.current) return; // ignore phantom pointer hover
      if (!viaPointer) hoverArmedRef.current = true; // keyboard focus is deliberate
    }
    setHoverMode(mode);
  }

  function expandHome() {
    sessionStorage.setItem("home-expanded", "1");
    setExpanded(true);
  }

  function handleActionClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    setPendingHref(href);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02060f]">
      <HomeBackdrop mode={hoverMode} zoneRef={zoneRef} />

      <div
        className={`relative z-10 mx-auto max-w-5xl px-6 transition-all duration-700 ease-out ${
          expanded ? "py-12 pt-20" : "flex min-h-screen items-center justify-center py-12"
        }`}
      >
        <button
          type="button"
          onClick={expandHome}
          className={`relative w-full rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-left shadow-xl shadow-slate-950/10 transition-all duration-700 ease-out ${
            expanded
              ? "mb-10 cursor-default"
              : "max-w-3xl cursor-pointer hover:shadow-[0_24px_80px_rgba(15,23,42,0.3)]"
          }`}
          aria-expanded={expanded}
        >
          <h1 className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-white">
            <span className="text-4xl font-bold tracking-tight">{t("home.title")}</span>
          </h1>
          <p className="max-w-2xl text-sm italic leading-6 text-slate-100">
            {t("home.subtitle")}
          </p>
          {!expanded && (
            <div className="mt-6 text-xs font-medium uppercase tracking-[0.28em] text-slate-200/80">
              {t("home.clickToStart")}
            </div>
          )}
          <span className="absolute bottom-4 right-5 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-200/70">
            v3.0
          </span>
        </button>

        <div
          className={`transition-all duration-700 ease-out ${
            expanded
              ? "translate-y-0 opacity-100"
              : "pointer-events-none absolute translate-y-8 opacity-0"
          }`}
        >
          <div className="grid gap-6 md:grid-cols-2">
            <EntryCard
              onHoverChange={(hovering, viaPointer) =>
                setCardHover(hovering ? "interview" : "idle", viaPointer)
              }
              title={t("home.interview.title")}
              description={t("home.interview.description")}
              tone="indigo"
              active={hoverMode === "interview"}
              bulletItems={[
                t("home.interview.bullet.config"),
                t("home.interview.bullet.resume"),
                t("home.interview.bullet.report"),
              ]}
              actions={[
                {
                  href: "/interview/choose",
                  label: t("home.interview.start"),
                  className: "bg-indigo-600 hover:bg-indigo-700 text-white",
                },
                {
                  href: "/history",
                  label: t("home.history"),
                  className: "border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-100",
                },
              ]}
              pendingHref={pendingHref}
              onActionClick={handleActionClick}
            />
            <EntryCard
              onHoverChange={(hovering, viaPointer) =>
                setCardHover(hovering ? "consult" : "idle", viaPointer)
              }
              title={t("home.consult.title")}
              description={t("home.consult.description")}
              tone="emerald"
              active={hoverMode === "consult"}
              bulletItems={[
                t("home.consult.bullet.single"),
                t("home.consult.bullet.multi"),
                t("home.consult.bullet.chat"),
              ]}
              actions={[
                {
                  href: "/summary",
                  label: t("home.consult.start"),
                  className: "bg-emerald-600 hover:bg-emerald-700 text-white",
                },
                {
                  href: "/consult/history",
                  label: t("home.history"),
                  className: "border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-100",
                },
              ]}
              pendingHref={pendingHref}
              onActionClick={handleActionClick}
            />
          </div>

          <section ref={zoneRef} className="relative mt-14 px-5 py-12 text-center">
            <div
              className={`text-sm font-medium uppercase tracking-[0.25em] text-slate-300/45 transition-opacity duration-500 ${
                hoverMode === "idle" ? "opacity-100" : "opacity-0"
              }`}
            >
              {t("home.updates.title")}
            </div>
          </section>

          <footer className="mt-6 pb-2 text-center text-[11px] leading-5 text-slate-300/80">
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <span>{t("home.profile.role")}</span>
              <span>{t("home.profile.name")}</span>
              <span>{t("home.profile.school")}</span>
              <a
                href="mailto:lechuanwang2003@163.com"
                className="text-slate-200 underline-offset-4 hover:text-white hover:underline"
              >
                lechuanwang2003@163.com
              </a>
              <a
                href="https://lechuanwang.xyz/"
                target="_blank"
                rel="noreferrer"
                className="text-slate-200 underline-offset-4 hover:text-white hover:underline"
              >
                {t("home.profile.website")}
              </a>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
}

function EntryCard({
  title,
  description,
  tone,
  active,
  bulletItems,
  actions,
  pendingHref,
  onActionClick,
  onHoverChange,
}: {
  title: string;
  description: string;
  tone: "indigo" | "emerald";
  active: boolean;
  bulletItems: string[];
  actions: Array<{
    href: string;
    label: string;
    className: string;
  }>;
  pendingHref: string | null;
  onActionClick: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  onHoverChange?: (hovering: boolean, viaPointer?: boolean) => void;
}) {
  // Cards sit transparent over the field by default and reveal their colour when
  // active. The highlight is driven by `active` (the gated hover state) rather
  // than CSS :hover, so it only appears after a real pointer move — in sync with
  // the backdrop word. The accent dot + border keep them reading as clickable.
  const tones = {
    indigo: {
      idle: "border-indigo-300/25 bg-white/[0.04]",
      active:
        "-translate-y-0.5 border-indigo-200/80 bg-indigo-50/95 shadow-[0_26px_70px_-30px_rgba(99,102,241,0.7)]",
      dot: "bg-indigo-400",
    },
    emerald: {
      idle: "border-emerald-300/25 bg-white/[0.04]",
      active:
        "-translate-y-0.5 border-emerald-200/80 bg-emerald-50/95 shadow-[0_26px_70px_-30px_rgba(16,185,129,0.65)]",
      dot: "bg-emerald-400",
    },
  } as const;
  const palette = tones[tone];

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    // Only release when focus actually leaves the card, not when moving
    // between the two action links inside it.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      onHoverChange?.(false, false);
    }
  }
  return (
    <div
      className={`relative rounded-2xl border p-6 backdrop-blur-md transition-all duration-300 ${
        active ? palette.active : palette.idle
      }`}
      onMouseEnter={() => onHoverChange?.(true, true)}
      onMouseMove={() => onHoverChange?.(true, true)}
      onMouseLeave={() => onHoverChange?.(false, true)}
      onFocus={() => onHoverChange?.(true, false)}
      onBlur={handleBlur}
    >
      <div
        className={`mb-3 flex items-center gap-2.5 text-2xl font-bold transition-colors duration-300 ${
          active ? "text-slate-900" : "text-white"
        }`}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${palette.dot} transition-transform duration-300 ${
            active ? "scale-125" : ""
          }`}
        />
        {title}
      </div>
      <p
        className={`mb-5 text-sm leading-6 transition-colors duration-300 ${
          active ? "text-slate-700" : "text-slate-300"
        }`}
      >
        {description}
      </p>
      <div
        className={`mb-6 space-y-2 text-sm transition-colors duration-300 ${
          active ? "text-slate-600" : "text-slate-400"
        }`}
      >
        {bulletItems.map((item) => (
          <div key={item} className="flex items-start gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
            <span>{item}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            onClick={(event) => onActionClick(event, action.href)}
            aria-busy={pendingHref === action.href}
            className={`inline-flex min-w-[7.5rem] items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors duration-200 ${action.className}`}
          >
            {pendingHref === action.href ? <LoadingDots /> : action.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex h-5 items-center gap-1" aria-label="Loading">
      <span className="h-1.5 w-1.5 animate-[group-thinking-dot_1.2s_ease-in-out_infinite] rounded-full bg-current" />
      <span className="h-1.5 w-1.5 animate-[group-thinking-dot_1.2s_ease-in-out_0.16s_infinite] rounded-full bg-current" />
      <span className="h-1.5 w-1.5 animate-[group-thinking-dot_1.2s_ease-in-out_0.32s_infinite] rounded-full bg-current" />
    </span>
  );
}
