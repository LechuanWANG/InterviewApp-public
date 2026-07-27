import {
  REPORT_DIMENSIONS,
  type AnswerAnnotation,
  type AnswerAnnotationSeverity,
  type AnswerAnnotationType,
  type MbtiLetter,
  type ReportDimension,
  type Round,
  type RoundAnnotationSummary,
  type RoundReview,
} from "../types";

type RawAnnotation = {
  roundIndex?: unknown;
  quote?: unknown;
  type?: unknown;
  dimensions?: unknown;
  mbtiLetters?: unknown;
  comment?: unknown;
  suggestion?: unknown;
  severity?: unknown;
};

type RawRoundReview = {
  roundIndex?: unknown;
  overallComment?: unknown;
  mainStrength?: unknown;
  mainIssue?: unknown;
  nextStep?: unknown;
};

const ANNOTATION_TYPES: AnswerAnnotationType[] = [
  "strength",
  "weakness",
  "suggestion",
  "clarity",
  "missing",
  "mbti_evidence",
];

const MBTI_LETTERS: MbtiLetter[] = ["E", "I", "S", "N", "T", "F", "J", "P"];

const SEVERITIES: AnswerAnnotationSeverity[] = ["low", "medium", "high"];

export function normalizeAnnotations(
  value: unknown,
  rounds: Pick<Round, "answer">[]
): AnswerAnnotation[] {
  if (!Array.isArray(value)) return [];

  const accepted: AnswerAnnotation[] = [];
  const perRoundCounts = new Map<number, number>();
  const occupiedRanges = new Map<number, Array<{ start: number; end: number }>>();

  for (const rawItem of value) {
    if (accepted.length >= 40) break;

    const raw = asRecord(rawItem) as RawAnnotation;
    const roundIndex = toRoundIndex(raw.roundIndex, rounds.length);
    if (!roundIndex) continue;

    const type = toAnnotationType(raw.type);
    if (!type) continue;

    const count = perRoundCounts.get(roundIndex) ?? 0;
    if (count >= 7) continue;

    const comment = asString(raw.comment);
    if (!comment) continue;

    const answer = rounds[roundIndex - 1]?.answer ?? "";
    const quote = asString(raw.quote) ?? "";
    const severity = toSeverity(raw.severity);
    const dimensions = toDimensions(raw.dimensions);
    const mbtiLetters = toMbtiLetters(raw.mbtiLetters);
    const suggestion = asString(raw.suggestion) ?? undefined;

    let start = 0;
    let end = 0;

    if (type !== "missing") {
      if (!quote) continue;
      const match = findQuoteRange(answer, quote);
      if (!match) continue;
      start = match.start;
      end = match.end;

      const ranges = occupiedRanges.get(roundIndex) ?? [];
      if (ranges.some((range) => start < range.end && end > range.start)) continue;
      ranges.push({ start, end });
      occupiedRanges.set(roundIndex, ranges);
    }

    perRoundCounts.set(roundIndex, count + 1);
    accepted.push({
      id: `r${roundIndex}-a${count + 1}`,
      roundIndex,
      start,
      end,
      quote,
      type,
      dimensions,
      ...(mbtiLetters.length > 0 ? { mbtiLetters } : {}),
      comment,
      suggestion,
      severity,
    });
  }

  return accepted.sort((a, b) => a.roundIndex - b.roundIndex || a.start - b.start);
}

export function summarizeAnnotations(
  annotations: AnswerAnnotation[],
  roundCount: number
): RoundAnnotationSummary[] {
  return Array.from({ length: roundCount }, (_, index) => {
    const roundIndex = index + 1;
    const roundAnnotations = annotations.filter((item) => item.roundIndex === roundIndex);
    return {
      roundIndex,
      strengths: roundAnnotations.filter((item) => item.type === "strength").length,
      weaknesses: roundAnnotations.filter(
        (item) => item.type === "weakness" || item.type === "clarity" || item.type === "missing"
      ).length,
      suggestions: roundAnnotations.filter((item) => item.type === "suggestion").length,
      mbtiEvidence: roundAnnotations.filter((item) => item.type === "mbti_evidence").length,
    };
  });
}

export function normalizeRoundReviews(value: unknown, roundCount: number): RoundReview[] {
  if (!Array.isArray(value)) return [];

  const accepted: RoundReview[] = [];
  const seenRounds = new Set<number>();

  for (const rawItem of value) {
    const raw = asRecord(rawItem) as RawRoundReview;
    const roundIndex = toRoundIndex(raw.roundIndex, roundCount);
    if (!roundIndex || seenRounds.has(roundIndex)) continue;

    const overallComment = asString(raw.overallComment);
    if (!overallComment) continue;

    const mainStrength = asString(raw.mainStrength) ?? undefined;
    const mainIssue = asString(raw.mainIssue) ?? undefined;
    const nextStep = asString(raw.nextStep) ?? undefined;

    accepted.push({
      roundIndex,
      overallComment,
      mainStrength,
      mainIssue,
      nextStep,
    });
    seenRounds.add(roundIndex);

    if (accepted.length >= roundCount) break;
  }

  return accepted.sort((a, b) => a.roundIndex - b.roundIndex);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toRoundIndex(value: unknown, roundCount: number): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > roundCount) return null;
  return numeric;
}

function toAnnotationType(value: unknown): AnswerAnnotationType | null {
  if (typeof value !== "string") return null;
  return ANNOTATION_TYPES.includes(value as AnswerAnnotationType)
    ? (value as AnswerAnnotationType)
    : null;
}

function toSeverity(value: unknown): AnswerAnnotationSeverity {
  if (typeof value !== "string") return "medium";
  return SEVERITIES.includes(value as AnswerAnnotationSeverity)
    ? (value as AnswerAnnotationSeverity)
    : "medium";
}

function toDimensions(value: unknown): ReportDimension[] {
  if (!Array.isArray(value)) return [];
  const dimensions = value.filter((item): item is ReportDimension =>
    REPORT_DIMENSIONS.includes(item as ReportDimension)
  );
  return Array.from(new Set(dimensions));
}

function toMbtiLetters(value: unknown): MbtiLetter[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter((item): item is MbtiLetter => MBTI_LETTERS.includes(item as MbtiLetter))
    )
  );
}

export function findQuoteRange(
  answer: string,
  quote: string
): { start: number; end: number } | null {
  if (!answer || !quote) return null;

  const exactStart = answer.indexOf(quote);
  if (exactStart >= 0) {
    return { start: exactStart, end: exactStart + quote.length };
  }

  const normalizedAnswer = normalizeForLooseMatch(answer);
  const normalizedQuote = normalizeForLooseMatch(quote);
  if (normalizedQuote.text.length < 2) return null;

  const normalizedStart = normalizedAnswer.text.indexOf(normalizedQuote.text);
  if (normalizedStart >= 0) {
    return normalizedRangeToOriginalRange(
      normalizedAnswer,
      normalizedStart,
      normalizedStart + normalizedQuote.text.length
    );
  }

  const orderedSegmentMatch = findOrderedSegmentRange(normalizedAnswer, normalizedQuote.text);
  if (orderedSegmentMatch) return orderedSegmentMatch;

  const fuzzyMatch = findFuzzyQuoteRange(normalizedAnswer, normalizedQuote.text);
  if (fuzzyMatch) return fuzzyMatch;

  const partialMatch = findPartialQuoteRange(normalizedAnswer, normalizedQuote.text);
  if (partialMatch) return partialMatch;

  return null;
}

function normalizedRangeToOriginalRange(
  normalizedAnswer: { text: string; map: number[] },
  startInclusive: number,
  endExclusive: number
): { start: number; end: number } | null {
  if (startInclusive < 0 || endExclusive <= startInclusive) return null;

  const start = normalizedAnswer.map[startInclusive];
  const lastNormalizedIndex = endExclusive - 1;
  const lastOriginalIndex = normalizedAnswer.map[lastNormalizedIndex];
  if (start === undefined || lastOriginalIndex === undefined) return null;

  return { start, end: lastOriginalIndex + 1 };
}

function findOrderedSegmentRange(
  normalizedAnswer: { text: string; map: number[] },
  normalizedQuote: string
): { start: number; end: number } | null {
  if (normalizedQuote.length < 18) return null;

  const segments = buildOrderedSegments(normalizedQuote);
  if (segments.length < 2) return null;

  let searchFrom = 0;
  let firstStart = -1;
  let lastEnd = -1;

  for (const segment of segments) {
    const index = normalizedAnswer.text.indexOf(segment, searchFrom);
    if (index < 0) return null;
    if (firstStart < 0) firstStart = index;
    lastEnd = index + segment.length;
    searchFrom = lastEnd;
  }

  if (firstStart < 0 || lastEnd <= firstStart) return null;
  const originalRange = normalizedRangeToOriginalRange(normalizedAnswer, firstStart, lastEnd);
  if (!originalRange) return null;

  // 避免 quote 被过度拉长，导致大段误标。
  const normalizedSpanLength = lastEnd - firstStart;
  if (normalizedSpanLength > Math.max(12, normalizedQuote.length * 1.8)) return null;
  return originalRange;
}

function buildOrderedSegments(text: string): string[] {
  const length = text.length;
  if (length >= 42) {
    const size = Math.max(6, Math.floor(length / 5));
    return [
      text.slice(0, size),
      text.slice(Math.floor(length / 2) - Math.floor(size / 2), Math.floor(length / 2) - Math.floor(size / 2) + size),
      text.slice(-size),
    ].filter((segment, index, segments) => segment.length >= 6 && segments.indexOf(segment) === index);
  }

  if (length >= 26) {
    const size = Math.max(6, Math.floor(length / 4));
    return [text.slice(0, size), text.slice(-size)].filter((segment) => segment.length >= 6);
  }

  const size = Math.max(5, Math.floor(length / 3));
  return [text.slice(0, size), text.slice(-size)].filter((segment) => segment.length >= 5);
}

function findFuzzyQuoteRange(
  normalizedAnswer: { text: string; map: number[] },
  normalizedQuote: string
): { start: number; end: number } | null {
  const quoteLength = normalizedQuote.length;
  if (quoteLength < 6) return null;

  const minWindow = Math.max(4, Math.floor(quoteLength * 0.82));
  const maxWindow = Math.min(normalizedAnswer.text.length, Math.ceil(quoteLength * 1.18));
  if (minWindow > maxWindow) return null;

  let best: { start: number; end: number; score: number; distance: number } | null = null;

  for (let size = minWindow; size <= maxWindow; size += 1) {
    for (let start = 0; start + size <= normalizedAnswer.text.length; start += 1) {
      const candidate = normalizedAnswer.text.slice(start, start + size);
      const distance = boundedEditDistance(normalizedQuote, candidate, allowedEditDistance(quoteLength));
      if (distance === null) continue;
      const score = 1 - distance / Math.max(quoteLength, size);
      if (score < fuzzyThreshold(quoteLength)) continue;
      if (!best || score > best.score || (score === best.score && distance < best.distance)) {
        best = { start, end: start + size, score, distance };
      }
    }
  }

  return best ? normalizedRangeToOriginalRange(normalizedAnswer, best.start, best.end) : null;
}

function findPartialQuoteRange(
  normalizedAnswer: { text: string; map: number[] },
  normalizedQuote: string
): { start: number; end: number } | null {
  if (normalizedQuote.length < 12) return null;

  const minLength = Math.max(8, Math.floor(normalizedQuote.length * 0.45));
  for (let length = normalizedQuote.length - 1; length >= minLength; length -= 1) {
    for (let start = 0; start + length <= normalizedQuote.length; start += 1) {
      const part = normalizedQuote.slice(start, start + length);
      const answerStart = normalizedAnswer.text.indexOf(part);
      if (answerStart >= 0) {
        return normalizedRangeToOriginalRange(normalizedAnswer, answerStart, answerStart + length);
      }
    }
  }

  return null;
}

function fuzzyThreshold(length: number): number {
  if (length <= 20) return 0.86;
  if (length <= 50) return 0.78;
  return 0.74;
}

function allowedEditDistance(length: number): number {
  if (length <= 10) return 1;
  if (length <= 20) return 2;
  if (length <= 50) return Math.floor(length * 0.22);
  return Math.floor(length * 0.26);
}

function boundedEditDistance(left: string, right: string, maxDistance: number): number | null {
  if (Math.abs(left.length - right.length) > maxDistance) return null;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMin = current[0];

    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > maxDistance) return null;
    previous = current;
  }

  const distance = previous[right.length];
  return distance <= maxDistance ? distance : null;
}

function normalizeForLooseMatch(text: string): { text: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];

  Array.from(text).forEach((char, index) => {
    const normalized = normalizeChar(char);
    if (!normalized) return;
    chars.push(normalized);
    map.push(index);
  });

  return { text: chars.join(""), map };
}

function normalizeChar(char: string): string {
  const normalized = char
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s/g, "");

  if (!normalized) return "";
  if (/[\p{P}\p{S}]/u.test(normalized)) return "";
  return normalized;
}
