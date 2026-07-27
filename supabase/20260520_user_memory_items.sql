-- Add typed long-term memory items for consultation memory.

CREATE TABLE IF NOT EXISTS user_memory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'local-default-user',
  type TEXT NOT NULL CHECK (type IN ('user_profile', 'interview_evidence', 'consultation_memory', 'common_issues')),
  content TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('interview', 'report', 'consultation', 'manual_edit')),
  source_id TEXT NOT NULL,
  source_title TEXT,
  quote_or_summary TEXT,
  confidence NUMERIC NOT NULL DEFAULT 0.75 CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'user_removed', 'superseded')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_memory_items_owner_profile_status
  ON user_memory_items(owner_id, profile_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_memory_items_source
  ON user_memory_items(owner_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_user_memory_items_type
  ON user_memory_items(owner_id, profile_id, type, status);

ALTER TABLE user_memory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own user_memory_items" ON user_memory_items;
CREATE POLICY "Users manage own user_memory_items" ON user_memory_items
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);

-- Existing completed consultations that had memory enabled should behave like saved memory records.
UPDATE consult_sessions
SET memory_save_status = 'saved'
WHERE memory_enabled = true
  AND (status = 'completed' OR summary IS NOT NULL)
  AND (memory_save_status IS NULL OR memory_save_status = 'pending');
