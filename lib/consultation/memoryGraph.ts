import { getLLM, type LLMOverride } from "../llm";
import { getSupabaseClient } from "../supabase";
import type {
  ConsultMemoryGraphEdge,
  ConsultMemoryGraphNode,
  ConsultMemoryGraphNodeStatus,
  ConsultMemoryGraphNodeType,
  ConsultMemoryGraphRelationType,
  ConsultMemoryGraphSnapshot,
  ConsultMemoryProfile,
  ConsultSession,
} from "./types";
import { getConsultMemoryProfile } from "./memoryProfile";
import { extractConsultMemoryItemsFromSession, type ConsultMemoryItemDraft } from "./memoryItems";
import { buildMemoryContributionSessions } from "./memoryCoverage";

const GRAPH_NODE_TABLE = "consult_memory_graph_nodes";
const GRAPH_EDGE_TABLE = "consult_memory_graph_edges";
const ROOT_NODE_LABEL = "长期画像";
const ROOT_NODE_KEY = "profile:profile";

const NODE_TYPES: ConsultMemoryGraphNodeType[] = [
  "profile",
  "target",
  "avoid_target",
  "strength",
  "risk",
  "resolved_issue",
  "practice_focus",
  "topic",
  "evidence",
];

const PROFILE_GRAPH_NODE_TYPES: ConsultMemoryGraphNodeType[] = [
  "profile",
  "strength",
  "risk",
  "resolved_issue",
  "topic",
  "evidence",
];

const NODE_STATUSES: ConsultMemoryGraphNodeStatus[] = ["active", "resolved", "archived", "superseded"];

const RELATION_TYPES: ConsultMemoryGraphRelationType[] = [
  "contains",
  "supports",
  "causes",
  "conflicts_with",
  "improves",
  "evidenced_by",
  "next_step",
];

type GraphNodeDraft = {
  type: ConsultMemoryGraphNodeType;
  label: string;
  summary: string;
  status: ConsultMemoryGraphNodeStatus;
  weightDelta: number;
  evidenceRefs: string[];
};

type GraphEdgeDraft = {
  sourceType: ConsultMemoryGraphNodeType;
  sourceLabel: string;
  targetType: ConsultMemoryGraphNodeType;
  targetLabel: string;
  relationType: ConsultMemoryGraphRelationType;
  weight: number;
};

type GraphUpdatePlan = {
  nodes: GraphNodeDraft[];
  edges: GraphEdgeDraft[];
};

type GraphPatchUpsertRaw = Partial<GraphNodeDraft> & {
  type?: string;
  status?: string;
  mergeWithExistingLabel?: string;
};

type GraphPatchRaw = Partial<{
  upserts: GraphPatchUpsertRaw[];
  nodes: GraphPatchUpsertRaw[];
  edges: Array<Partial<GraphEdgeDraft> & { sourceType?: string; targetType?: string; relationType?: string }>;
}>;

export async function getConsultMemoryGraphSnapshot(params: {
  ownerId: string;
  profileId: string;
  limit?: number;
}): Promise<ConsultMemoryGraphSnapshot | null> {
  if (!hasSupabaseEnv()) return null;

  try {
    const supabase = getSupabaseClient();
    const nodes = await listGraphNodes(params.ownerId, params.profileId, params.limit);
    if (!nodes.length) return null;

    const nodeIds = new Set(nodes.map((node) => node.id));
    const { data: edgeRows, error: edgeError } = await supabase
      .from(GRAPH_EDGE_TABLE)
      .select("*")
      .eq("owner_id", params.ownerId)
      .eq("profile_id", params.profileId)
      .order("weight", { ascending: false });

    if (edgeError) {
      if (isMissingGraphTableError(edgeError.message)) return null;
      throw edgeError;
    }

    const edges = (edgeRows || [])
      .map(rowToGraphEdge)
      .filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId));

    return {
      nodes,
      edges,
      sourceSessionCount: countGraphSourceSessions(nodes),
      summary: buildGraphSummary(nodes),
      updatedAt: Math.max(...nodes.map((node) => node.updatedAt).filter(Number.isFinite)),
    };
  } catch (error) {
    if (isMissingGraphTableError(error instanceof Error ? error.message : String(error))) {
      return null;
    }
    throw error;
  }
}

async function listGraphNodes(
  ownerId: string,
  profileId: string,
  limit?: number
): Promise<ConsultMemoryGraphNode[]> {
  const supabase = getSupabaseClient();
  let nodeQuery = supabase
    .from(GRAPH_NODE_TABLE)
    .select("*")
    .eq("owner_id", ownerId)
    .eq("profile_id", profileId)
    .in("status", ["active", "resolved"])
    .order("weight", { ascending: false })
    .order("last_seen_at", { ascending: false });

  if (limit) nodeQuery = nodeQuery.limit(limit);
  const { data, error } = await nodeQuery;
  if (error) {
    if (isMissingGraphTableError(error.message)) return [];
    throw error;
  }
  return (data || []).map(rowToGraphNode);
}

export async function updateConsultMemoryGraphFromSession(params: {
  session: ConsultSession;
  llm?: LLMOverride;
  useLLM?: boolean;
}): Promise<ConsultMemoryGraphSnapshot | null> {
  if (!hasSupabaseEnv() || !params.session.summary || params.session.memoryEnabled === false) return null;

  try {
    const existingNodes = await listGraphNodes(params.session.ownerId, params.session.memoryProfileId, 160);
    const compactProfile = await getConsultMemoryProfile({
      ownerId: params.session.ownerId,
      profileId: params.session.memoryProfileId,
    });
    const items = extractConsultMemoryItemsFromSession(params.session);
    const candidatePlan = buildLocalGraphCandidatePlan(params.session, compactProfile, items);
    const relevantExistingNodes = selectRelevantExistingNodes(
      existingNodes,
      candidatePlan,
      params.session,
      items,
      40
    );
    const plan = params.useLLM === false
      ? candidatePlan
      : await buildLLMGraphPlan(
          params.session,
          relevantExistingNodes,
          compactProfile,
          items,
          candidatePlan,
          params.llm
        );

    await upsertGraphPlan(params.session, plan);
    return getConsultMemoryGraphSnapshot({
      ownerId: params.session.ownerId,
      profileId: params.session.memoryProfileId,
    });
  } catch (error) {
    if (isMissingGraphTableError(error instanceof Error ? error.message : String(error))) {
      return null;
    }
    throw error;
  }
}

export async function rebuildConsultMemoryGraphFromSessions(params: {
  ownerId: string;
  profileId: string;
  sessions: ConsultSession[];
  llm?: LLMOverride;
  useLLM?: boolean;
}): Promise<ConsultMemoryGraphSnapshot | null> {
  if (!hasSupabaseEnv()) return null;

  const savedSessions = params.sessions
    .filter(
      (session) =>
        session.ownerId === params.ownerId &&
        session.memoryProfileId === params.profileId &&
        session.memoryEnabled !== false &&
        session.memorySaveStatus === "saved" &&
        !!session.summary
    )
    .sort((left, right) => (left.endedAt || left.updatedAt) - (right.endedAt || right.updatedAt));

  await deleteConsultMemoryGraph({ ownerId: params.ownerId, profileId: params.profileId });
  if (!savedSessions.length) return null;

  let snapshot: ConsultMemoryGraphSnapshot | null = null;
  for (const session of buildMemoryContributionSessions(savedSessions)) {
    snapshot = await updateConsultMemoryGraphFromSession({
      session,
      llm: params.llm || { provider: session.provider, model: session.model },
      useLLM: params.useLLM,
    });
  }
  return snapshot;
}

export async function deleteConsultMemoryGraph(params: {
  ownerId: string;
  profileId: string;
}): Promise<void> {
  if (!hasSupabaseEnv()) return;

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from(GRAPH_NODE_TABLE)
      .delete()
      .eq("owner_id", params.ownerId)
      .eq("profile_id", params.profileId);
    if (error && !isMissingGraphTableError(error.message)) throw error;
  } catch (error) {
    if (!isMissingGraphTableError(error instanceof Error ? error.message : String(error))) {
      throw error;
    }
  }
}

async function buildLLMGraphPlan(
  session: ConsultSession,
  relevantExistingNodes: ConsultMemoryGraphNode[],
  compactProfile: ConsultMemoryProfile | null,
  items: ConsultMemoryItemDraft[],
  candidatePlan: GraphUpdatePlan,
  llm?: LLMOverride
): Promise<GraphUpdatePlan> {
  try {
    const raw = await getLLM(llm).completeJSON<GraphPatchRaw>({
      system: "你是求职战略咨询产品的长期记忆图谱增量合并器。只输出合法 JSON，不输出 markdown。",
      messages: [
        {
          role: "user",
          content: buildGraphUpdatePrompt(session, relevantExistingNodes, compactProfile, items, candidatePlan),
        },
      ],
    });
    const normalized = normalizeGraphPlan(raw, candidatePlan, relevantExistingNodes);
    return normalized.nodes.length >= 3 ? normalized : candidatePlan;
  } catch (error) {
    console.error("Failed to update consult memory graph with LLM", error);
    return candidatePlan;
  }
}

function buildGraphUpdatePrompt(
  session: ConsultSession,
  relevantExistingNodes: ConsultMemoryGraphNode[],
  compactProfile: ConsultMemoryProfile | null,
  items: ConsultMemoryItemDraft[],
  candidatePlan: GraphUpdatePlan
): string {
  return `请把本次战略咨询候选节点合并为“长期面试画像图谱”的增量 patch。

目标：
- 你不是从零抽取图谱；只能从“本地候选新节点”里选择值得保留的节点。
- 如果“可合并旧节点”里有语义相同或高度相近的节点，必须填写 mergeWithExistingLabel，复用旧 label，不要换个说法新建。
- 只输出本次增量 patch，不要输出整张图。
- 这张图只描述“用户在面试中的长期特点”，不是建议图、计划图、岗位推荐图。
- 不追求面面俱到，只保留反复出现、能代表用户个人面试模式的信息。
- 节点要短、具体、个性化，像长期记忆索引；summary 用一句话解释“用户通常如何表现”或“证据来自哪里”。
- strength / risk / topic / evidence 是最高优先级。
- resolved_issue 只放已经明确不再优先讨论的问题。
- 禁止把建议、训练重点、7天计划、下一步行动作为节点；不要输出 practice_focus。
- 禁止把主攻方向、暂缓方向作为用户画像节点；不要输出 target / avoid_target。
- topic 只能表示面试表现维度，例如“项目深挖”“逻辑表达”“结果证据”“业务理解”“动机表达”，不能表示练习计划。
- evidence 只能是具体面试记录或明确证据来源。
- 优先输出这些强语义关系：
  - profile contains strength / risk / topic / resolved_issue：中心画像包含稳定面试特征。
  - strength supports topic：优势支撑某个表现维度。
  - risk causes topic：风险影响某个表现维度。
  - resolved_issue improves risk：已缓解问题改善了相关风险。
  - concept evidenced_by evidence：画像判断由具体面试证据支持。
- 每条边必须能读成一句清楚的话，例如“业务归因表达不足 影响 结果证据”或“表达结构稳定 支撑 逻辑表达”。

可用节点类型：
profile, strength, risk, resolved_issue, topic, evidence

可用关系类型：
contains, supports, causes, conflicts_with, improves, evidenced_by, next_step

只输出 JSON：
{
  "upserts": [
    {
      "type": "risk",
      "label": "业务归因表达不足",
      "mergeWithExistingLabel": "业务结果表达不足",
      "summary": "多次能说模型或方法，但没有稳定转成业务指标和商业结果。",
      "status": "active",
      "weightDelta": 1.2,
      "evidenceRefs": ["字节跳动 · 数据分析实习生"]
    }
  ],
  "edges": [
    {
      "sourceType": "profile",
      "sourceLabel": "长期画像",
      "targetType": "risk",
      "targetLabel": "业务归因表达不足",
      "relationType": "contains",
      "weight": 1
    }
  ]
}

字段约束：
- upserts 最多 8 条，只能使用“本地候选新节点”的 type 和 label；如果合并旧节点，label 仍写候选 label，并填写 mergeWithExistingLabel。
- mergeWithExistingLabel 只能来自“可合并旧节点”的同类型节点 label；没有可合并节点时填 null 或省略。
- edges 最多 12 条，只连接本次 upserts 或长期画像根节点。
- 如果节点合并到旧节点，edges 里可以使用候选 label 或旧 label，系统会自动归一到旧 label。

【可合并旧节点（已按类型、相似度、最近更新、权重和本次关键词筛选，最多 40 个）】
${relevantExistingNodes.length
  ? relevantExistingNodes
      .map((node) => `- ${node.type}｜${node.label}｜${node.status}｜w=${node.weight.toFixed(1)}｜${node.summary}`)
      .join("\n")
  : "暂无。"}

【本地候选新节点（请只从这里选择 upserts）】
${candidatePlan.nodes
  .filter((node) => node.type !== "profile")
  .slice(0, 40)
  .map((node) => `- ${node.type}｜${node.label}｜${node.status}｜w+=${node.weightDelta.toFixed(1)}｜${node.summary}｜证据：${node.evidenceRefs.join("；") || "无"}`)
  .join("\n") || "暂无。"}

【compact 长期画像】
${compactProfile ? formatCompactProfile(compactProfile) : "暂无。"}

	【本次咨询结论】
总体判断：${session.summary?.currentJudgement || ""}
反复问题：${(session.summary?.repeatedIssues || []).join("；") || "无"}

【本次所选面试】
${session.records
  .slice(0, 6)
  .map((record) => {
    const weaknesses = (record.report.weaknesses || []).slice(0, 2).join("；") || "暂无";
    const strengths = (record.report.strengths || []).slice(0, 2).join("；") || "暂无";
    return `- ${record.company} · ${record.jobTitle}｜${record.report.overallBand}/9｜优势：${strengths}｜短板：${weaknesses}`;
  })
  .join("\n")}

【本次结构化记忆条目】
${items
  .slice(0, 30)
  .map((item) => `- ${item.type}/${item.tags.join(",")}: ${item.content}`)
  .join("\n")}`;
}

function normalizeGraphPlan(
  raw: GraphPatchRaw,
  candidatePlan: GraphUpdatePlan,
  relevantExistingNodes: ConsultMemoryGraphNode[]
): GraphUpdatePlan {
  const candidateNodes = candidatePlan.nodes.filter((node) => node.type !== "profile");
  const candidateNodeMap = new Map(candidatePlan.nodes.map((node) => [nodeKey(node.type, node.label), node]));
  const aliasByKey = new Map<string, { type: ConsultMemoryGraphNodeType; label: string }>();
  const nodes: GraphNodeDraft[] = [];
  const upserts = raw.upserts?.length ? raw.upserts : raw.nodes || [];
  for (const item of upserts.slice(0, 8)) {
    const type = normalizeNodeType(item.type);
    const label = cleanText(item.label, 70);
    if (!type || !isProfileGraphNodeType(type) || !label) continue;
    const candidate = candidateNodeMap.get(nodeKey(type, label)) || findBestCandidateNode(type, label, candidateNodes);
    if (!candidate) continue;
    const mergeLabel = cleanText(item.mergeWithExistingLabel, 70);
    const mergeTarget = mergeLabel
      ? findBestExistingNode(type, mergeLabel, relevantExistingNodes)
      : findBestExistingNode(type, label, relevantExistingNodes, 8);
    const finalLabel = mergeTarget?.label || candidate.label;
    const finalStatus = mergeTarget?.status || normalizeNodeStatus(item.status) || candidate.status;
    const summary = cleanText(item.summary, 180) || candidate.summary || mergeTarget?.summary || finalLabel;
    const evidenceRefs = cleanTextArray(item.evidenceRefs, 5, 90);
    nodes.push({
      type,
      label: finalLabel,
      summary,
      status: finalStatus,
      weightDelta: clampWeight(Number(item.weightDelta ?? candidate.weightDelta ?? 1)),
      evidenceRefs: evidenceRefs.length ? evidenceRefs : candidate.evidenceRefs,
    });
    aliasByKey.set(nodeKey(type, label), { type, label: finalLabel });
    aliasByKey.set(nodeKey(type, candidate.label), { type, label: finalLabel });
    if (mergeTarget) aliasByKey.set(nodeKey(type, mergeTarget.label), { type, label: finalLabel });
  }

  const mergedNodes = dedupeNodeDrafts([
    rootNodeDraft(candidatePlan.nodes.find((node) => node.type === "profile")?.summary),
    ...nodes,
  ]);
  const nodeSet = new Set(mergedNodes.map((node) => nodeKey(node.type, node.label)));
  const edges: GraphEdgeDraft[] = [];
  for (const item of (raw.edges || []).slice(0, 12)) {
    const sourceType = normalizeNodeType(item.sourceType);
    const targetType = normalizeNodeType(item.targetType);
    const sourceLabel = cleanText(item.sourceLabel, 70);
    const targetLabel = cleanText(item.targetLabel, 70);
    const relationType = normalizeRelationType(item.relationType);
    if (!sourceType || !targetType || !sourceLabel || !targetLabel || !relationType) continue;
    const source = canonicalPatchNodeRef(sourceType, sourceLabel, aliasByKey);
    const target = canonicalPatchNodeRef(targetType, targetLabel, aliasByKey);
    if (!nodeSet.has(nodeKey(source.type, source.label)) || !nodeSet.has(nodeKey(target.type, target.label))) continue;
    edges.push({
      sourceType: source.type,
      sourceLabel: source.label,
      targetType: target.type,
      targetLabel: target.label,
      relationType,
      weight: clampWeight(Number(item.weight ?? 1)),
    });
  }
  const fallbackEdges = canonicalizeGraphEdges(candidatePlan.edges, aliasByKey, nodeSet);

  return {
    nodes: mergedNodes.length > 1 ? mergedNodes : candidatePlan.nodes,
    edges: edges.length ? dedupeEdgeDrafts(edges) : fallbackEdges,
  };
}

function selectRelevantExistingNodes(
  nodes: ConsultMemoryGraphNode[],
  candidatePlan: GraphUpdatePlan,
  session: ConsultSession,
  items: ConsultMemoryItemDraft[],
  limit: number
): ConsultMemoryGraphNode[] {
  if (!nodes.length) return [];
  const candidates = candidatePlan.nodes.filter((node) => node.type !== "profile");
  const keywords = graphSelectionKeywords(session, items, candidates);
  const scored = nodes
    .map((node) => ({
      node,
      score: existingNodeRelevanceScore(node, candidates, keywords),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      right.node.weight - left.node.weight ||
      right.node.lastSeenAt - left.node.lastSeenAt
    )
    .slice(0, limit);

  const selected = scored.map((entry) => entry.node);
  const root = nodes.find((node) => node.type === "profile");
  if (root && !selected.some((node) => node.id === root.id)) {
    selected.unshift(root);
  }
  return selected.slice(0, limit);
}

function existingNodeRelevanceScore(
  node: ConsultMemoryGraphNode,
  candidates: GraphNodeDraft[],
  keywords: string[]
): number {
  if (node.type === "profile") return 12;
  let score = 0;
  for (const candidate of candidates) {
    if (node.type !== candidate.type) continue;
    const labelScore = textSimilarityScore(node.label, candidate.label);
    const summaryScore = textSimilarityScore(node.summary, candidate.label) * 0.45;
    score = Math.max(score, 2 + labelScore + summaryScore);
  }
  const text = `${node.label} ${node.summary} ${node.evidenceRefs.join(" ")}`;
  if (matchesAnyKeyword(text, keywords)) score += 3;
  score += Math.min(3, node.weight / 3);
  if (Date.now() - node.lastSeenAt < 1000 * 60 * 60 * 24 * 45) score += 1;
  return score >= 3 ? score : 0;
}

function graphSelectionKeywords(
  session: ConsultSession,
  items: ConsultMemoryItemDraft[],
  candidates: GraphNodeDraft[]
): string[] {
  return uniqueTexts(
    [
      ...(session.summary?.repeatedIssues || []),
      session.summary?.currentJudgement || "",
      ...items.map((item) => item.content),
      ...candidates.map((node) => node.label),
      ...session.records.flatMap((record) => [
        record.jobTitle,
        record.company,
        ...(record.report.weaknesses || []),
        ...(record.report.strengths || []),
      ]),
    ],
    36
  ).map((item) => item.slice(0, 24));
}

function findBestCandidateNode(
  type: ConsultMemoryGraphNodeType,
  label: string,
  candidates: GraphNodeDraft[]
): GraphNodeDraft | null {
  const best = candidates
    .filter((node) => node.type === type)
    .map((node) => ({ node, score: textSimilarityScore(node.label, label) }))
    .sort((left, right) => right.score - left.score)[0];
  return best && best.score >= 5 ? best.node : null;
}

function findBestExistingNode(
  type: ConsultMemoryGraphNodeType,
  label: string,
  nodes: ConsultMemoryGraphNode[],
  threshold = 5
): ConsultMemoryGraphNode | null {
  const best = nodes
    .filter((node) => node.type === type)
    .map((node) => ({ node, score: textSimilarityScore(node.label, label) }))
    .sort((left, right) => right.score - left.score || right.node.weight - left.node.weight)[0];
  return best && best.score >= threshold ? best.node : null;
}

function canonicalPatchNodeRef(
  type: ConsultMemoryGraphNodeType,
  label: string,
  aliasByKey: Map<string, { type: ConsultMemoryGraphNodeType; label: string }>
): { type: ConsultMemoryGraphNodeType; label: string } {
  return aliasByKey.get(nodeKey(type, label)) || { type, label };
}

function canonicalizeGraphEdges(
  edges: GraphEdgeDraft[],
  aliasByKey: Map<string, { type: ConsultMemoryGraphNodeType; label: string }>,
  nodeSet: Set<string>
): GraphEdgeDraft[] {
  return dedupeEdgeDrafts(
    edges
      .map((edge) => {
        const source = canonicalPatchNodeRef(edge.sourceType, edge.sourceLabel, aliasByKey);
        const target = canonicalPatchNodeRef(edge.targetType, edge.targetLabel, aliasByKey);
        if (!nodeSet.has(nodeKey(source.type, source.label)) || !nodeSet.has(nodeKey(target.type, target.label))) {
          return null;
        }
        return {
          ...edge,
          sourceType: source.type,
          sourceLabel: source.label,
          targetType: target.type,
          targetLabel: target.label,
        };
      })
      .filter((edge): edge is GraphEdgeDraft => !!edge)
  );
}

function buildLocalGraphCandidatePlan(
  session: ConsultSession,
  compactProfile: ConsultMemoryProfile | null,
  items: ConsultMemoryItemDraft[]
): GraphUpdatePlan {
  const summary = session.summary;
  const evidenceRefs = uniqueTexts(
    [
      ...session.records.map((record) => `${record.company} · ${record.jobTitle}`),
      ...(compactProfile?.evidenceRefs || []),
    ],
    8
  );
  const nodes: GraphNodeDraft[] = [
    rootNodeDraft(compactProfile?.compactSummary || summary?.currentJudgement),
  ];

  const riskCandidates = uniqueTexts(
    [
      ...items.filter((item) => item.tags.includes("repeated_issue")).map((item) => item.content),
      ...(summary?.repeatedIssues || []),
      ...session.records.flatMap((record) => record.report.weaknesses || []),
    ],
    8
  );
  for (const item of riskCandidates) {
    addNodeDraft(nodes, "risk", item, {
      summary: `用户在面试中反复出现或值得跟踪的表现风险：${item}`,
      weightDelta: 1.2,
      evidenceRefs,
    });
  }

  const strengths = uniqueTexts(
    [
      ...session.records.flatMap((record) => record.report.strengths || []),
    ],
    5
  );
  for (const item of strengths) {
    addNodeDraft(nodes, "strength", item, {
      summary: `可以继续包装和复用的稳定优势：${item}`,
      weightDelta: 0.75,
      evidenceRefs,
    });
  }

  for (const item of uniqueTexts(compactProfile?.resolvedIssues || [], 4)) {
    addNodeDraft(nodes, "resolved_issue", item, {
      summary: `该问题已被讨论或明显缓解，后续不应反复占用咨询主线：${item}`,
      status: "resolved",
      weightDelta: 0.7,
      evidenceRefs,
    });
  }

  for (const item of inferTopicLabels(session, items)) {
    addNodeDraft(nodes, "topic", item, {
      summary: `历史咨询已围绕「${item}」形成过讨论。`,
      weightDelta: 0.55,
      evidenceRefs,
    });
  }

  for (const record of session.records.slice(0, 4)) {
    addNodeDraft(nodes, "evidence", `${record.company} · ${record.jobTitle}`, {
      summary: `面试记录分数 ${record.report.overallBand}/9，是长期画像判断的证据来源。`,
      weightDelta: 0.7,
      evidenceRefs: [`${record.company} · ${record.jobTitle}`],
    });
  }

  const dedupedNodes = dedupeNodeDrafts(nodes);
  const edges = buildFallbackEdges(dedupedNodes);

  return { nodes: dedupedNodes, edges };
}

function buildFallbackEdges(nodes: GraphNodeDraft[]): GraphEdgeDraft[] {
  const edges: GraphEdgeDraft[] = [];
  const root = nodes.find((node) => node.type === "profile");
  if (!root) return edges;

  const risks = nodes.filter((node) => node.type === "risk").slice(0, 5);
  const strengths = nodes.filter((node) => node.type === "strength").slice(0, 5);
  const resolved = nodes.filter((node) => node.type === "resolved_issue").slice(0, 3);
  const topics = nodes.filter((node) => node.type === "topic").slice(0, 3);
  const evidence = nodes.filter((node) => node.type === "evidence").slice(0, 4);

  for (const node of [...risks.slice(0, 5), ...strengths.slice(0, 5), ...resolved, ...topics]) {
    edges.push({
      sourceType: root.type,
      sourceLabel: root.label,
      targetType: node.type,
      targetLabel: node.label,
      relationType: "contains",
      weight: Math.min(2.5, node.weightDelta),
    });
  }

  for (const strength of strengths) {
    const topic = topics[0];
    if (!topic) continue;
    edges.push({
      sourceType: strength.type,
      sourceLabel: strength.label,
      targetType: topic.type,
      targetLabel: topic.label,
      relationType: "supports",
      weight: 1,
    });
  }

  for (const risk of risks) {
    const topic = topics[0];
    if (!topic) continue;
    edges.push({
      sourceType: risk.type,
      sourceLabel: risk.label,
      targetType: topic.type,
      targetLabel: topic.label,
      relationType: "causes",
      weight: 1,
    });
  }

  for (const issue of resolved) {
    const targetRisk = risks[0];
    if (!targetRisk) continue;
    edges.push({
      sourceType: issue.type,
      sourceLabel: issue.label,
      targetType: targetRisk.type,
      targetLabel: targetRisk.label,
      relationType: "improves",
      weight: 0.75,
    });
  }

  for (const concept of [...risks.slice(0, 3), ...strengths.slice(0, 3), ...resolved.slice(0, 2), ...topics.slice(0, 2)]) {
    const evidenceNode = evidence[0];
    if (!evidenceNode) continue;
    edges.push({
      sourceType: concept.type,
      sourceLabel: concept.label,
      targetType: evidenceNode.type,
      targetLabel: evidenceNode.label,
      relationType: "evidenced_by",
      weight: 0.8,
    });
  }

  return dedupeEdgeDrafts(edges);
}

async function upsertGraphPlan(session: ConsultSession, plan: GraphUpdatePlan): Promise<void> {
  const supabase = getSupabaseClient();
  const now = Date.now();
  const existingSnapshot = await getConsultMemoryGraphSnapshot({
    ownerId: session.ownerId,
    profileId: session.memoryProfileId,
    limit: 160,
  });
  const existingByKey = new Map<string, ConsultMemoryGraphNode>();
  for (const node of existingSnapshot?.nodes || []) {
    existingByKey.set(nodeKey(node.type, node.label), node);
  }

  const nodeRows = dedupeNodeDrafts(plan.nodes).map((draft) => {
    const key = nodeKey(draft.type, draft.label);
    const existing = existingByKey.get(key);
    const alreadyIncludesSession = existing?.sourceSessionIds.includes(session.id) ?? false;
    const newEvidenceRefs = (draft.evidenceRefs || []).filter(
      (ref) => !existing?.evidenceRefs.some((existingRef) => normalizeEvidenceRef(existingRef) === normalizeEvidenceRef(ref))
    );
    const contributesNewEvidence = !existing || newEvidenceRefs.length > 0;
    const sourceSessionIds = contributesNewEvidence
      ? uniqueTexts([...(existing?.sourceSessionIds || []), session.id], 24)
      : existing?.sourceSessionIds || [];
    const evidenceRefs = uniqueTexts([...(draft.evidenceRefs || []), ...(existing?.evidenceRefs || [])], 12);
    const nextWeight = existing
      ? alreadyIncludesSession || !contributesNewEvidence
        ? Math.max(existing.weight, draft.weightDelta)
        : Math.min(20, existing.weight + draft.weightDelta)
      : Math.max(0.5, draft.weightDelta);

    return {
      owner_id: session.ownerId,
      profile_id: session.memoryProfileId,
      type: draft.type,
      label: draft.label,
      normalized_label: normalizedLabelForType(draft.type, draft.label),
      summary: mergeSummary(existing?.summary, draft.summary),
      weight: nextWeight,
      status: draft.status,
      source_session_ids: sourceSessionIds,
      evidence_refs: evidenceRefs,
      created_at: existing ? new Date(existing.createdAt).toISOString() : new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      last_seen_at: new Date(now).toISOString(),
    };
  });

  const { error: nodeError } = await supabase
    .from(GRAPH_NODE_TABLE)
    .upsert(nodeRows, { onConflict: "owner_id,profile_id,type,normalized_label" });
  if (nodeError) throw nodeError;

  const { data: nodeData, error: fetchNodeError } = await supabase
    .from(GRAPH_NODE_TABLE)
    .select("*")
    .eq("owner_id", session.ownerId)
    .eq("profile_id", session.memoryProfileId);
  if (fetchNodeError) throw fetchNodeError;

  const nodeIdByKey = new Map<string, string>();
  for (const row of nodeData || []) {
    const node = rowToGraphNode(row);
    nodeIdByKey.set(nodeKey(node.type, node.label), node.id);
  }

  const existingEdges = await listGraphEdges(session.ownerId, session.memoryProfileId);
  const existingEdgeByKey = new Map(existingEdges.map((edge) => [edgeKey(edge), edge]));
  const edgeRows = dedupeEdgeDrafts(plan.edges)
    .map((draft) => {
      const sourceNodeId = nodeIdByKey.get(nodeKey(draft.sourceType, draft.sourceLabel));
      const targetNodeId = nodeIdByKey.get(nodeKey(draft.targetType, draft.targetLabel));
      if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return null;
      const existing = existingEdgeByKey.get(`${sourceNodeId}:${targetNodeId}:${draft.relationType}`);
      return {
        owner_id: session.ownerId,
        profile_id: session.memoryProfileId,
        source_node_id: sourceNodeId,
        target_node_id: targetNodeId,
        relation_type: draft.relationType,
        weight: existing ? Math.max(existing.weight, draft.weight) : draft.weight,
        created_at: existing ? new Date(existing.createdAt).toISOString() : new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => !!row);

  if (!edgeRows.length) return;
  const { error: edgeError } = await supabase
    .from(GRAPH_EDGE_TABLE)
    .upsert(edgeRows, { onConflict: "owner_id,profile_id,source_node_id,target_node_id,relation_type" });
  if (edgeError) throw edgeError;
}

async function listGraphEdges(ownerId: string, profileId: string): Promise<ConsultMemoryGraphEdge[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(GRAPH_EDGE_TABLE)
    .select("*")
    .eq("owner_id", ownerId)
    .eq("profile_id", profileId)
    .limit(240);
  if (error) {
    if (isMissingGraphTableError(error.message)) return [];
    throw error;
  }
  return (data || []).map(rowToGraphEdge);
}

function rootNodeDraft(summary?: string | null): GraphNodeDraft {
  return {
    type: "profile",
    label: ROOT_NODE_LABEL,
    summary: cleanText(summary, 220) || "长期战略咨询画像会随每次咨询持续更新。",
    status: "active",
    weightDelta: 1,
    evidenceRefs: [],
  };
}

function addNodeDraft(
  nodes: GraphNodeDraft[],
  type: ConsultMemoryGraphNodeType,
  label: string,
  options: Partial<Omit<GraphNodeDraft, "type" | "label">> = {}
) {
  const cleaned = cleanText(label, 70);
  if (!cleaned) return;
  nodes.push({
    type,
    label: cleaned,
    summary: cleanText(options.summary, 180) || cleaned,
    status: options.status || defaultStatusForType(type),
    weightDelta: clampWeight(options.weightDelta ?? 1),
    evidenceRefs: cleanTextArray(options.evidenceRefs, 6, 90),
  });
}

function inferTopicLabels(session: ConsultSession, items: ConsultMemoryItemDraft[]): string[] {
  const topics = new Set<string>();
  for (const item of items) {
    if (item.tags.includes("covered_topic")) topics.add(item.content);
  }
  const text = [
    session.summary?.currentJudgement,
    ...(session.summary?.repeatedIssues || []),
    ...session.records.flatMap((record) => [
      ...(record.report.strengths || []),
      ...(record.report.weaknesses || []),
    ]),
  ]
    .join(" ")
    .replace(/\s+/g, "");

  if (/项目|经历|实习|深挖/.test(text)) topics.add("项目深挖");
  if (/表达|逻辑|结构/.test(text)) topics.add("逻辑表达");
  if (/数据|指标|量化|结果|证据/.test(text)) topics.add("结果证据");
  if (/业务|商业|归因|行业|理解/.test(text)) topics.add("业务理解");
  if (/动机|意愿|稳定|匹配/.test(text)) topics.add("动机表达");

  return Array.from(topics).slice(0, 5);
}

function dedupeNodeDrafts(nodes: GraphNodeDraft[]): GraphNodeDraft[] {
  const map = new Map<string, GraphNodeDraft>();
  for (const node of nodes) {
    const key = nodeKey(node.type, node.label);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, node);
      continue;
    }
    map.set(key, {
      ...existing,
      summary: mergeSummary(existing.summary, node.summary),
      weightDelta: Math.min(20, existing.weightDelta + node.weightDelta),
      status: existing.status === "resolved" ? existing.status : node.status,
      evidenceRefs: uniqueTexts([...existing.evidenceRefs, ...node.evidenceRefs], 8),
    });
  }
  return Array.from(map.values());
}

function dedupeEdgeDrafts(edges: GraphEdgeDraft[]): GraphEdgeDraft[] {
  const map = new Map<string, GraphEdgeDraft>();
  for (const edge of edges) {
    const key = `${nodeKey(edge.sourceType, edge.sourceLabel)}:${nodeKey(edge.targetType, edge.targetLabel)}:${edge.relationType}`;
    const existing = map.get(key);
    map.set(key, existing ? { ...existing, weight: Math.max(existing.weight, edge.weight) } : edge);
  }
  return Array.from(map.values());
}

function normalizeNodeType(value: unknown): ConsultMemoryGraphNodeType | null {
  return typeof value === "string" && NODE_TYPES.includes(value as ConsultMemoryGraphNodeType)
    ? value as ConsultMemoryGraphNodeType
    : null;
}

function isProfileGraphNodeType(type: ConsultMemoryGraphNodeType): boolean {
  return PROFILE_GRAPH_NODE_TYPES.includes(type);
}

function normalizeNodeStatus(value: unknown): ConsultMemoryGraphNodeStatus | null {
  return typeof value === "string" && NODE_STATUSES.includes(value as ConsultMemoryGraphNodeStatus)
    ? value as ConsultMemoryGraphNodeStatus
    : null;
}

function normalizeRelationType(value: unknown): ConsultMemoryGraphRelationType | null {
  return typeof value === "string" && RELATION_TYPES.includes(value as ConsultMemoryGraphRelationType)
    ? value as ConsultMemoryGraphRelationType
    : null;
}

function defaultStatusForType(type: ConsultMemoryGraphNodeType): ConsultMemoryGraphNodeStatus {
  return type === "resolved_issue" ? "resolved" : "active";
}

function nodeKey(type: ConsultMemoryGraphNodeType, label: string): string {
  return `${type}:${normalizedLabelForType(type, label)}`;
}

function normalizedLabelForType(type: ConsultMemoryGraphNodeType, label: string): string {
  if (type === "profile") return "profile";
  return normalizeGraphLabel(label);
}

function normalizeGraphLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[，。！？；、,.!?;:：\s"'""''\-—_（）()【】[\]]/g, "")
    .replace(/^(问题|短板|建议|主攻方向|训练重点|暂不建议|已解决)/, "")
    .slice(0, 80)
    .trim();
}

function textSimilarityScore(left: string, right: string): number {
  const leftKey = normalizeGraphLabel(left);
  const rightKey = normalizeGraphLabel(right);
  if (!leftKey || !rightKey) return 0;
  if (leftKey === rightKey) return 10;
  const shorter = leftKey.length <= rightKey.length ? leftKey : rightKey;
  const longer = leftKey.length > rightKey.length ? leftKey : rightKey;
  if (shorter.length >= 4 && longer.includes(shorter)) return 8;

  const leftChars = new Set(leftKey.split(""));
  const rightChars = new Set(rightKey.split(""));
  let shared = 0;
  for (const char of leftChars) {
    if (rightChars.has(char)) shared += 1;
  }
  const overlap = shared / Math.max(1, Math.min(leftChars.size, rightChars.size));
  if (overlap >= 0.78) return 6;
  if (overlap >= 0.62) return 4;
  return overlap >= 0.48 ? 2 : 0;
}

function matchesAnyKeyword(text: string, keywords: string[]): boolean {
  const normalized = normalizeGraphLabel(text);
  return keywords.some((keyword) => {
    const key = normalizeGraphLabel(keyword);
    return key.length >= 2 && normalized.includes(key);
  });
}

function normalizeEvidenceRef(label: string): string {
  return label
    .toLowerCase()
    .replace(/[，。！？；、,.!?;:：\s"'""''\-—_（）()【】[\]]/g, "")
    .slice(0, 100)
    .trim();
}

function edgeKey(edge: ConsultMemoryGraphEdge): string {
  return `${edge.sourceNodeId}:${edge.targetNodeId}:${edge.relationType}`;
}

function rowToGraphNode(row: Record<string, unknown>): ConsultMemoryGraphNode {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    profileId: row.profile_id as string,
    type: row.type as ConsultMemoryGraphNodeType,
    label: row.label as string,
    summary: (row.summary as string) || "",
    weight: Number(row.weight ?? 1),
    status: row.status as ConsultMemoryGraphNodeStatus,
    sourceSessionIds: Array.isArray(row.source_session_ids) ? row.source_session_ids as string[] : [],
    evidenceRefs: Array.isArray(row.evidence_refs) ? row.evidence_refs as string[] : [],
    createdAt: new Date(row.created_at as string).getTime(),
    updatedAt: new Date(row.updated_at as string).getTime(),
    lastSeenAt: new Date(row.last_seen_at as string).getTime(),
  };
}

function rowToGraphEdge(row: Record<string, unknown>): ConsultMemoryGraphEdge {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    profileId: row.profile_id as string,
    sourceNodeId: row.source_node_id as string,
    targetNodeId: row.target_node_id as string,
    relationType: row.relation_type as ConsultMemoryGraphRelationType,
    weight: Number(row.weight ?? 1),
    createdAt: new Date(row.created_at as string).getTime(),
    updatedAt: new Date(row.updated_at as string).getTime(),
  };
}

function buildGraphSummary(nodes: ConsultMemoryGraphNode[]): string | null {
  const strength = topNode(nodes, "strength");
  const risk = topNode(nodes, "risk");
  const topic = topNode(nodes, "topic");
  if (!strength && !risk && !topic) {
    return nodes.find((node) => node.type === "profile")?.summary || null;
  }
  return [
    strength ? `稳定优势是 ${strength.label}` : "",
    risk ? `核心风险是 ${risk.label}` : "",
    topic ? `重点表现维度是 ${topic.label}` : "",
  ]
    .filter(Boolean)
    .join("；");
}

function topNode(nodes: ConsultMemoryGraphNode[], type: ConsultMemoryGraphNodeType): ConsultMemoryGraphNode | null {
  return nodes
    .filter((node) => node.type === type)
    .sort((left, right) => right.weight - left.weight || right.lastSeenAt - left.lastSeenAt)[0] || null;
}

function countGraphSourceSessions(nodes: ConsultMemoryGraphNode[]): number {
  const ids = new Set<string>();
  for (const node of nodes) {
    for (const id of node.sourceSessionIds) ids.add(id);
  }
  return ids.size;
}

function formatCompactProfile(profile: ConsultMemoryProfile): string {
  return [
    `摘要：${profile.compactSummary}`,
    `当前主攻：${profile.currentTarget || "无"}`,
    `暂不建议：${profile.avoidTargets.join("；") || "无"}`,
    `稳定优势：${profile.stableStrengths.join("；") || "无"}`,
    `反复问题：${profile.recurringIssues.join("；") || "无"}`,
    `已解决/缓解：${profile.resolvedIssues.join("；") || "无"}`,
    `训练重点：${profile.practiceFocus.join("；") || "无"}`,
  ].join("\n");
}

function cleanText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function cleanTextArray(value: unknown, limit: number, itemLimit: number): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueTexts(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => cleanText(item, itemLimit))
      .filter(Boolean),
    limit
  );
}

function uniqueTexts(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const text = cleanText(item, 240);
    const key = normalizeGraphLabel(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function mergeSummary(previous: string | undefined, next: string): string {
  const cleanedNext = cleanText(next, 180);
  const cleanedPrevious = cleanText(previous, 180);
  if (!cleanedPrevious) return cleanedNext;
  if (!cleanedNext) return cleanedPrevious;
  if (normalizeGraphLabel(cleanedPrevious) === normalizeGraphLabel(cleanedNext)) return cleanedPrevious;
  return cleanedNext.length >= cleanedPrevious.length * 0.65 ? cleanedNext : cleanedPrevious;
}

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.3, Math.min(3, value));
}

function hasSupabaseEnv(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function isMissingGraphTableError(message: string): boolean {
  return (
    message.includes(GRAPH_NODE_TABLE) ||
    message.includes(GRAPH_EDGE_TABLE) ||
    message.includes("Could not find the table") ||
    message.includes("does not exist")
  );
}
