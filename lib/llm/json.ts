type RepairFn = (text: string) => Promise<string>;

export async function parseJSONWithRepair<T>(
  text: string,
  repair?: RepairFn
): Promise<T> {
  const cleaned = cleanJSONText(text);
  const candidates = unique([
    cleaned,
    extractJSONObject(cleaned),
    normalizeCommonJSONIssues(cleaned),
    normalizeCommonJSONIssues(extractJSONObject(cleaned)),
  ]).filter(Boolean);

  for (const candidate of candidates) {
    const parsed = tryParseJSON<T>(candidate);
    if (parsed !== null) return parsed;
  }

  if (repair) {
    const repaired = cleanJSONText(await repair(cleaned));
    const repairedCandidates = unique([
      repaired,
      extractJSONObject(repaired),
      normalizeCommonJSONIssues(repaired),
      normalizeCommonJSONIssues(extractJSONObject(repaired)),
    ]).filter(Boolean);

    for (const candidate of repairedCandidates) {
      const parsed = tryParseJSON<T>(candidate);
      if (parsed !== null) return parsed;
    }
  }

  throw new Error("LLM did not return valid JSON: " + text.slice(0, 300));
}

function tryParseJSON<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function cleanJSONText(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractJSONObject(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match?.[0]?.trim() ?? "";
}

function normalizeCommonJSONIssues(text: string): string {
  if (!text) return text;

  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
