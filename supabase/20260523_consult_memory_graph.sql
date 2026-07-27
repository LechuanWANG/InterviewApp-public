-- Add long-term consultation memory graph.
-- Nodes represent stable career profile concepts; edges represent how they
-- relate, so the consultation Agent can use memory as a structured map rather
-- than a pasted report summary.

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

ALTER TABLE consult_memory_graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE consult_memory_graph_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own consult_memory_graph_nodes" ON consult_memory_graph_nodes;
CREATE POLICY "Users manage own consult_memory_graph_nodes" ON consult_memory_graph_nodes
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);

DROP POLICY IF EXISTS "Users manage own consult_memory_graph_edges" ON consult_memory_graph_edges;
CREATE POLICY "Users manage own consult_memory_graph_edges" ON consult_memory_graph_edges
  FOR ALL TO authenticated USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
