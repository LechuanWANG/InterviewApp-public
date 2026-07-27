-- Add compact long-term consultation memory profiles.
-- This table stores a compressed career-strategy memory per user/profile so
-- prompts can use more history without pasting many raw memory items.

CREATE TABLE IF NOT EXISTS consult_memory_profiles (
  owner_id TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'local-default-user',
  version INTEGER NOT NULL DEFAULT 1,
  compact_summary TEXT NOT NULL DEFAULT '',
  current_target TEXT,
  avoid_targets TEXT[] NOT NULL DEFAULT '{}',
  stable_strengths TEXT[] NOT NULL DEFAULT '{}',
  recurring_issues TEXT[] NOT NULL DEFAULT '{}',
  resolved_issues TEXT[] NOT NULL DEFAULT '{}',
  practice_focus TEXT[] NOT NULL DEFAULT '{}',
  recent_shift TEXT,
  evidence_refs TEXT[] NOT NULL DEFAULT '{}',
  source_session_count INTEGER NOT NULL DEFAULT 0,
  last_compacted_session_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_consult_memory_profiles_updated
  ON consult_memory_profiles(owner_id, profile_id, updated_at DESC);

ALTER TABLE consult_memory_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own consult_memory_profiles" ON consult_memory_profiles;
CREATE POLICY "Users manage own consult_memory_profiles" ON consult_memory_profiles
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
