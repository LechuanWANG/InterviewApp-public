"use client";

import { useMemo, useState } from "react";
import type { AnswerAnnotation } from "@/lib/types";
import { useI18n } from "./LanguageProvider";

export default function AnnotatedAnswer({
  answer,
  annotations,
}: {
  answer: string;
  annotations: AnswerAnnotation[];
}) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { inlineAnnotations, missingAnnotations } = useMemo(
    () => splitAnnotations(answer, annotations),
    [answer, annotations]
  );

  if (!inlineAnnotations.length && !missingAnnotations.length) {
    return <div className="text-sm text-slate-700 whitespace-pre-wrap">{answer}</div>;
  }

  let cursor = 0;

  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-700 whitespace-pre-wrap leading-7">
        {inlineAnnotations.map((annotation) => {
          const before = answer.slice(cursor, annotation.start);
          const marked = answer.slice(annotation.start, annotation.end);
          cursor = annotation.end;

          return (
            <span key={annotation.id}>
              {before}
              <AnnotatedSegment
                annotation={annotation}
                active={activeId === annotation.id}
                onToggle={() =>
                  setActiveId((current) => (current === annotation.id ? null : annotation.id))
                }
                onClose={() => setActiveId(null)}
              >
                {marked}
              </AnnotatedSegment>
            </span>
          );
        })}
        {answer.slice(cursor)}
      </div>

      {missingAnnotations.length > 0 && (
        <div className="space-y-2">
          {missingAnnotations.map((annotation) => (
            <div key={annotation.id} className="rounded-md border bg-slate-50 p-3 text-sm">
              <div className="mb-1 text-xs font-medium text-slate-500">{t("annotation.missingInfo")}</div>
              <div className="text-slate-700">{annotation.comment}</div>
              {annotation.suggestion && (
                <div className="mt-1 text-indigo-700">{t("annotation.advice", { text: annotation.suggestion })}</div>
              )}
              {annotation.dimensions.length > 0 && (
                <div className="mt-2 text-xs text-slate-500">
                  {t("annotation.dimensions", {
                    text: annotation.dimensions.map((dimension) => t(`dimension.${dimension}`)).join(" / "),
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnnotatedSegment({
  annotation,
  active,
  children,
  onToggle,
  onClose,
}: {
  annotation: AnswerAnnotation;
  active: boolean;
  children: string;
  onToggle: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <span className="relative inline whitespace-normal align-baseline group">
      <span
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onBlur={onClose}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        className={`inline whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded px-0.5 text-left align-baseline underline decoration-2 underline-offset-4 ${styleForType(
          annotation.type
        )}`}
      >
        {children}
      </span>
      <span
        className={`absolute bottom-full left-0 z-20 mb-2 w-72 rounded-md border bg-white p-3 text-left text-xs leading-5 text-slate-700 shadow-lg whitespace-normal ${
          active ? "block" : "hidden group-hover:block group-focus-within:block"
        }`}
      >
        <span className="mb-1 block font-medium text-slate-900">{labelForType(annotation.type, t)}</span>
        {annotation.type === "mbti_evidence" && annotation.mbtiLetters?.length ? (
          <span className="mb-1 block text-violet-700">
            {t("annotation.evidence", { text: annotation.mbtiLetters.join(" / ") })}
          </span>
        ) : null}
        <span className="block">{annotation.comment}</span>
        {annotation.type !== "mbti_evidence" && annotation.suggestion && (
          <span className="mt-1 block text-indigo-700">{t("annotation.advice", { text: annotation.suggestion })}</span>
        )}
        {annotation.type !== "mbti_evidence" && annotation.dimensions.length > 0 && (
          <span className="mt-2 block text-slate-500">
            {t("annotation.dimensions", {
              text: annotation.dimensions.map((dimension) => t(`dimension.${dimension}`)).join(" / "),
            })}
          </span>
        )}
      </span>
    </span>
  );
}

function splitAnnotations(answer: string, annotations: AnswerAnnotation[]) {
  const missingAnnotations = annotations.filter((annotation) => annotation.type === "missing");
  const inlineAnnotations = annotations
    .filter(
      (annotation) =>
        annotation.type !== "missing" &&
        annotation.start >= 0 &&
        annotation.end > annotation.start &&
        annotation.end <= answer.length
    )
    .sort((first, second) => first.start - second.start || first.end - second.end)
    .reduce<AnswerAnnotation[]>((result, annotation) => {
      const previous = result[result.length - 1];
      if (previous && annotation.start < previous.end) return result;
      result.push(annotation);
      return result;
    }, []);

  return { inlineAnnotations, missingAnnotations };
}

function styleForType(type: AnswerAnnotation["type"]): string {
  if (type === "strength") return "bg-emerald-50 decoration-emerald-500 hover:bg-emerald-100";
  if (type === "weakness") return "bg-rose-50 decoration-rose-500 hover:bg-rose-100";
  if (type === "suggestion") return "bg-sky-50 decoration-sky-500 hover:bg-sky-100";
  if (type === "clarity") return "bg-amber-50 decoration-amber-500 hover:bg-amber-100";
  if (type === "mbti_evidence") return "bg-violet-50 decoration-violet-500 hover:bg-violet-100";
  return "bg-slate-50 decoration-slate-400 hover:bg-slate-100";
}

function labelForType(
  type: AnswerAnnotation["type"],
  t: (key: string) => string
): string {
  if (type === "strength") return t("annotation.strength");
  if (type === "weakness") return t("annotation.weakness");
  if (type === "suggestion") return t("annotation.suggestion");
  if (type === "clarity") return t("annotation.clarity");
  if (type === "mbti_evidence") return t("annotation.mbtiEvidence");
  return t("annotation.missingInfo");
}
