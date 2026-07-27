-- Add per-user ownership columns so Vercel/Supabase-authenticated users only see their own data.
-- Replace 'legacy-local-user' with your Supabase Auth user id if you want to assign old local/demo data to your account.

ALTER TABLE interview_sessions
  ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE interview_history
  ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE consult_sessions
  ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE consult_messages
  ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE interview_experience_ratings
  ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE consult_experience_ratings
  ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE consult_memory_resolutions
  ADD COLUMN IF NOT EXISTS owner_id TEXT;

UPDATE interview_sessions SET owner_id = 'legacy-local-user' WHERE owner_id IS NULL;
UPDATE interview_history SET owner_id = 'legacy-local-user' WHERE owner_id IS NULL;
UPDATE consult_sessions SET owner_id = 'legacy-local-user' WHERE owner_id IS NULL;
UPDATE consult_messages SET owner_id = 'legacy-local-user' WHERE owner_id IS NULL;
UPDATE interview_experience_ratings SET owner_id = 'legacy-local-user' WHERE owner_id IS NULL;
UPDATE consult_experience_ratings SET owner_id = 'legacy-local-user' WHERE owner_id IS NULL;

ALTER TABLE interview_sessions
  ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE interview_history
  ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE consult_sessions
  ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE consult_messages
  ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE interview_experience_ratings
  ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE consult_experience_ratings
  ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_interview_sessions_owner_created_at
  ON interview_sessions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_history_owner_reported_at
  ON interview_history(owner_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_consult_sessions_owner_created_at
  ON consult_sessions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consult_messages_owner_session
  ON consult_messages(owner_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_interview_experience_ratings_owner_id
  ON interview_experience_ratings(owner_id);
CREATE INDEX IF NOT EXISTS idx_consult_experience_ratings_owner_id
  ON consult_experience_ratings(owner_id);
CREATE INDEX IF NOT EXISTS idx_consult_memory_resolutions_owner_id
  ON consult_memory_resolutions(owner_id);

DROP POLICY IF EXISTS "Allow all on interview_sessions" ON interview_sessions;
DROP POLICY IF EXISTS "Allow all on interview_history" ON interview_history;
DROP POLICY IF EXISTS "Allow all on consult_sessions" ON consult_sessions;
DROP POLICY IF EXISTS "Allow all on consult_messages" ON consult_messages;
DROP POLICY IF EXISTS "Allow all on interview_experience_ratings" ON interview_experience_ratings;
DROP POLICY IF EXISTS "Allow all on consult_experience_ratings" ON consult_experience_ratings;
DROP POLICY IF EXISTS "Allow all on consult_memory_resolutions" ON consult_memory_resolutions;

DROP POLICY IF EXISTS "Users manage own interview_sessions" ON interview_sessions;
DROP POLICY IF EXISTS "Users manage own interview_history" ON interview_history;
DROP POLICY IF EXISTS "Users manage own consult_sessions" ON consult_sessions;
DROP POLICY IF EXISTS "Users manage own consult_messages" ON consult_messages;
DROP POLICY IF EXISTS "Users manage own interview_experience_ratings" ON interview_experience_ratings;
DROP POLICY IF EXISTS "Users manage own consult_experience_ratings" ON consult_experience_ratings;
DROP POLICY IF EXISTS "Users manage own consult_memory_resolutions" ON consult_memory_resolutions;

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
