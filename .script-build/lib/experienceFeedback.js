"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveInterviewExperienceRating = saveInterviewExperienceRating;
exports.saveConsultExperienceRating = saveConsultExperienceRating;
const supabase_1 = require("./supabase");
async function saveInterviewExperienceRating({ targetId, rating, ownerId, }) {
    await saveExperienceRating("interview_experience_ratings", "session_id", targetId, rating, ownerId);
}
async function saveConsultExperienceRating({ targetId, rating, ownerId, }) {
    await saveExperienceRating("consult_experience_ratings", "consult_session_id", targetId, rating, ownerId);
}
function normalizeRating(value) {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
        throw new Error("rating must be an integer from 1 to 5");
    }
    return value;
}
async function saveExperienceRating(table, idColumn, targetId, rating, ownerId) {
    const cleanTargetId = targetId.trim();
    if (!cleanTargetId)
        throw new Error("target id is required");
    const supabase = (0, supabase_1.getSupabaseClient)();
    const { error } = await supabase.from(table).upsert({
        [idColumn]: cleanTargetId,
        owner_id: ownerId,
        rating: normalizeRating(rating),
        updated_at: new Date().toISOString(),
    }, { onConflict: idColumn });
    if (error)
        throw new Error(`Failed to save experience rating: ${error.message}`);
}
