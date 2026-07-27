-- Smart Group Interview (智能群面 / AI 无领导小组讨论)
-- Run this in Supabase SQL Editor after the base schema.

CREATE TABLE IF NOT EXISTS group_interview_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  resume TEXT NOT NULL,
  company TEXT NOT NULL,
  job_title TEXT NOT NULL,
  jd TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'zh',
  difficulty TEXT NOT NULL DEFAULT 'medium',
  durations JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  thinking_enabled BOOLEAN NOT NULL DEFAULT false,
  voice JSONB NOT NULL DEFAULT '{}'::jsonb,
  topic JSONB NOT NULL,
  members JSONB NOT NULL DEFAULT '[]'::jsonb,
  phase TEXT NOT NULL DEFAULT 'opening',
  transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
  reporter_id TEXT,
  reporter_kind TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  delete_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_group_interview_sessions_owner_created_at
  ON group_interview_sessions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_interview_sessions_owner_active_created_at
  ON group_interview_sessions(owner_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE group_interview_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own group_interview_sessions" ON group_interview_sessions;
CREATE POLICY "Users manage own group_interview_sessions" ON group_interview_sessions
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
