-- Add product-experience rating tables for completed interviews and consultations.
-- Run this once in Supabase SQL Editor for existing deployments.

CREATE TABLE IF NOT EXISTS interview_experience_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_experience_ratings_session_id
  ON interview_experience_ratings(session_id);
CREATE INDEX IF NOT EXISTS idx_interview_experience_ratings_updated_at
  ON interview_experience_ratings(updated_at DESC);

CREATE TABLE IF NOT EXISTS consult_experience_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consult_session_id UUID NOT NULL UNIQUE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consult_experience_ratings_consult_session_id
  ON consult_experience_ratings(consult_session_id);
CREATE INDEX IF NOT EXISTS idx_consult_experience_ratings_updated_at
  ON consult_experience_ratings(updated_at DESC);

ALTER TABLE interview_experience_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE consult_experience_ratings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'interview_experience_ratings'
      AND policyname = 'Allow all on interview_experience_ratings'
  ) THEN
    CREATE POLICY "Allow all on interview_experience_ratings"
      ON interview_experience_ratings
      FOR ALL TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'consult_experience_ratings'
      AND policyname = 'Allow all on consult_experience_ratings'
  ) THEN
    CREATE POLICY "Allow all on consult_experience_ratings"
      ON consult_experience_ratings
      FOR ALL TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;
