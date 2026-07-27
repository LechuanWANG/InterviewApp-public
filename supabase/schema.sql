-- Supabase schema for InterviewApp
-- Run this in Supabase SQL Editor (https://app.supabase.com → your project → SQL Editor)

-- 1. Interview sessions (live, in-progress interviews)
CREATE TABLE IF NOT EXISTS interview_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  resume TEXT NOT NULL,
  company TEXT NOT NULL,
  job_title TEXT NOT NULL,
  jd TEXT NOT NULL,
  interview_type TEXT NOT NULL DEFAULT 'mixed',
  language TEXT NOT NULL DEFAULT 'zh',
  persona TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'simulate',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  thinking_enabled BOOLEAN NOT NULL DEFAULT false,
  plan JSONB,
  rounds JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_question TEXT,
  current_is_follow_up BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'created',
  report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  delete_reason TEXT
);

-- 2. Interview history (completed interviews, permanent records)
CREATE TABLE IF NOT EXISTS interview_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  session_id UUID NOT NULL,
  resume TEXT NOT NULL,
  company TEXT NOT NULL,
  job_title TEXT NOT NULL,
  jd TEXT NOT NULL,
  interview_type TEXT NOT NULL,
  language TEXT NOT NULL,
  persona TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  mode TEXT NOT NULL,
  rounds JSONB NOT NULL DEFAULT '[]'::jsonb,
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  delete_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_interview_history_reported_at ON interview_history(reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_history_session_id ON interview_history(session_id);
CREATE INDEX IF NOT EXISTS idx_interview_history_owner_reported_at ON interview_history(owner_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_owner_created_at ON interview_sessions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_history_owner_active_reported_at
  ON interview_history(owner_id, reported_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_interview_sessions_owner_active_created_at
  ON interview_sessions(owner_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- 3. Consultation sessions
CREATE TABLE IF NOT EXISTS consult_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  selected_interview_session_ids UUID[] NOT NULL DEFAULT '{}',
  summary_mode TEXT NOT NULL DEFAULT 'single_session',
  goal TEXT NOT NULL DEFAULT 'common_issues',
  mentor_type TEXT NOT NULL DEFAULT 'zhang_xuefeng_style',
  memory_profile_id TEXT NOT NULL DEFAULT 'local-default-user',
  memory_enabled BOOLEAN NOT NULL DEFAULT true,
  memory_save_status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  ended_by TEXT,
  records JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  delete_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_consult_sessions_created_at ON consult_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consult_sessions_memory_profile ON consult_sessions(memory_profile_id);
CREATE INDEX IF NOT EXISTS idx_consult_sessions_owner_created_at ON consult_sessions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consult_sessions_owner_active_created_at
  ON consult_sessions(owner_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- 4. Consultation messages (linked to consult_sessions)
CREATE TABLE IF NOT EXISTS consult_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  session_id UUID NOT NULL REFERENCES consult_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  delete_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_consult_messages_session ON consult_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_consult_messages_owner_session ON consult_messages(owner_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_consult_messages_owner_active_session
  ON consult_messages(owner_id, session_id, created_at)
  WHERE deleted_at IS NULL;

-- 5. Interview experience ratings (user-facing product feedback, not interview performance score)
CREATE TABLE IF NOT EXISTS interview_experience_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  session_id UUID NOT NULL UNIQUE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  delete_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_interview_experience_ratings_session_id
  ON interview_experience_ratings(session_id);
CREATE INDEX IF NOT EXISTS idx_interview_experience_ratings_owner_id
  ON interview_experience_ratings(owner_id);
CREATE INDEX IF NOT EXISTS idx_interview_experience_ratings_updated_at
  ON interview_experience_ratings(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_experience_ratings_owner_active
  ON interview_experience_ratings(owner_id, session_id)
  WHERE deleted_at IS NULL;

-- 6. Consultation experience ratings (user-facing product feedback, not consultation quality score)
CREATE TABLE IF NOT EXISTS consult_experience_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  consult_session_id UUID NOT NULL UNIQUE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  delete_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_consult_experience_ratings_consult_session_id
  ON consult_experience_ratings(consult_session_id);
CREATE INDEX IF NOT EXISTS idx_consult_experience_ratings_owner_id
  ON consult_experience_ratings(owner_id);
CREATE INDEX IF NOT EXISTS idx_consult_experience_ratings_updated_at
  ON consult_experience_ratings(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_consult_experience_ratings_owner_active
  ON consult_experience_ratings(owner_id, consult_session_id)
  WHERE deleted_at IS NULL;

-- 7. Consultation memory resolutions (resolved issues by profile)
CREATE TABLE IF NOT EXISTS consult_memory_resolutions (
  normalized_key TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'local-default-user',
  owner_id TEXT,
  label TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (normalized_key, profile_id)
);

-- 8. User memory items (typed long-term memory for consultations and future agents)
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

-- 9. Compact long-term consultation memory profile
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

-- 10. Consultation memory graph (long-term career profile as nodes and relations)
CREATE TABLE IF NOT EXISTS consult_memory_graph_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'local-default-user',
  type TEXT NOT NULL CHECK (
    type IN (
      'profile',
      'target',
      'avoid_target',
      'strength',
      'risk',
      'resolved_issue',
      'practice_focus',
      'topic',
      'evidence'
    )
  ),
  label TEXT NOT NULL,
  normalized_label TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  weight NUMERIC NOT NULL DEFAULT 1 CHECK (weight >= 0 AND weight <= 20),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'archived', 'superseded')),
  source_session_ids TEXT[] NOT NULL DEFAULT '{}',
  evidence_refs TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, profile_id, type, normalized_label)
);

CREATE TABLE IF NOT EXISTS consult_memory_graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'local-default-user',
  source_node_id UUID NOT NULL REFERENCES consult_memory_graph_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES consult_memory_graph_nodes(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (
    relation_type IN (
      'contains',
      'supports',
      'causes',
      'conflicts_with',
      'improves',
      'evidenced_by',
      'next_step'
    )
  ),
  weight NUMERIC NOT NULL DEFAULT 1 CHECK (weight >= 0 AND weight <= 20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, profile_id, source_node_id, target_node_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_consult_memory_graph_nodes_owner_profile
  ON consult_memory_graph_nodes(owner_id, profile_id, status, weight DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_consult_memory_graph_nodes_source_sessions
  ON consult_memory_graph_nodes USING GIN (source_session_ids);
CREATE INDEX IF NOT EXISTS idx_consult_memory_graph_edges_owner_profile
  ON consult_memory_graph_edges(owner_id, profile_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_consult_memory_graph_edges_source
  ON consult_memory_graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_consult_memory_graph_edges_target
  ON consult_memory_graph_edges(target_node_id);

-- 11. Smart Group Interview sessions (智能群面 / AI 无领导小组讨论)
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

-- Enable RLS (optional for single-user, but recommended)
ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE consult_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE consult_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_experience_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE consult_experience_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE consult_memory_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE consult_memory_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE consult_memory_graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE consult_memory_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_interview_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own interview_sessions" ON interview_sessions
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY "Users manage own interview_history" ON interview_history
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY "Users manage own consult_sessions" ON consult_sessions
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY "Users manage own consult_messages" ON consult_messages
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY "Users manage own interview_experience_ratings" ON interview_experience_ratings
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY "Users manage own consult_experience_ratings" ON consult_experience_ratings
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY "Users manage own consult_memory_resolutions" ON consult_memory_resolutions
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY "Users manage own user_memory_items" ON user_memory_items
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY "Users manage own consult_memory_profiles" ON consult_memory_profiles
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY "Users manage own consult_memory_graph_nodes" ON consult_memory_graph_nodes
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY "Users manage own consult_memory_graph_edges" ON consult_memory_graph_edges
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY "Users manage own group_interview_sessions" ON group_interview_sessions
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);

UPDATE consult_sessions
SET memory_save_status = 'saved'
WHERE memory_enabled = true
  AND (status = 'completed' OR summary IS NOT NULL)
  AND (memory_save_status IS NULL OR memory_save_status = 'pending');

-- Also allow service_role to bypass RLS (default behavior, no policy needed)
