-- Soft-delete user-facing interview and consultation records.
-- Deleted rows remain available in Supabase for admin/audit use, while app
-- queries filter them out by default.

ALTER TABLE interview_sessions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE interview_history
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE consult_sessions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE consult_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE interview_experience_ratings
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE consult_experience_ratings
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_interview_sessions_owner_active_created_at
  ON interview_sessions(owner_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_interview_history_owner_active_reported_at
  ON interview_history(owner_id, reported_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_consult_sessions_owner_active_created_at
  ON consult_sessions(owner_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_consult_messages_owner_active_session
  ON consult_messages(owner_id, session_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_interview_experience_ratings_owner_active
  ON interview_experience_ratings(owner_id, session_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_consult_experience_ratings_owner_active
  ON consult_experience_ratings(owner_id, consult_session_id)
  WHERE deleted_at IS NULL;
