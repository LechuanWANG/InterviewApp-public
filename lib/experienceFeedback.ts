import { getSupabaseClient } from "./supabase";

export type ExperienceKind = "interview" | "consult";

export type ExperienceRatingInput = {
  targetId: string;
  rating: number;
  ownerId: string;
};

export async function saveInterviewExperienceRating({
  targetId,
  rating,
  ownerId,
}: ExperienceRatingInput): Promise<void> {
  await saveExperienceRating("interview_experience_ratings", "session_id", targetId, rating, ownerId);
}

export async function saveConsultExperienceRating({
  targetId,
  rating,
  ownerId,
}: ExperienceRatingInput): Promise<void> {
  await saveExperienceRating("consult_experience_ratings", "consult_session_id", targetId, rating, ownerId);
}

function normalizeRating(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("rating must be an integer from 1 to 5");
  }
  return value;
}

async function saveExperienceRating(
  table: "interview_experience_ratings" | "consult_experience_ratings",
  idColumn: "session_id" | "consult_session_id",
  targetId: string,
  rating: number,
  ownerId: string
): Promise<void> {
  const cleanTargetId = targetId.trim();
  if (!cleanTargetId) throw new Error("target id is required");

  const supabase = getSupabaseClient();
  const { error } = await supabase.from(table).upsert(
    {
      [idColumn]: cleanTargetId,
      owner_id: ownerId,
      rating: normalizeRating(rating),
      deleted_at: null,
      deleted_by: null,
      delete_reason: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: idColumn }
  );

  if (error) throw new Error(`Failed to save experience rating: ${error.message}`);
}
