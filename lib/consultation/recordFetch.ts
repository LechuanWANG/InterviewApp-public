import { getLLM, type LLMOverride } from "../llm";
import { listInterviewRecords, type InterviewHistoryRecord } from "../historyStore";
import { getGroupSession, listGroupSessions } from "../groupInterview/store";
import { groupSessionToConsultRecord } from "./groupRecordAdapter";
import { detectRecordAnalysisIntent } from "./intent";

const DEFAULT_RECORD_LIMIT = 8;
// 用户显式置顶的焦点记录给更高上限，避免被默认上限静默截断。
const PINNED_RECORD_LIMIT = 12;

/**
 * 是否需要为本轮对话检索面试记录：关键词快路径 + 轻量 LLM 兜底。
 * 只有提到「面试/复盘/表现」等且关键词未命中时才花一次轻量 LLM，避免常态多余开销。
 */
export async function shouldRetrieveRecords(content: string, llm?: LLMOverride): Promise<boolean> {
  if (detectRecordAnalysisIntent(content)) return true;
  if (!/面试|复盘|表现|岗位|分数|那场|上一?场/i.test(content)) return false;
  try {
    const raw = await getLLM(llm).completeJSON<{ needRecords?: boolean }>({
      system: "你判断用户这句话是否希望基于他过去的模拟面试记录做复盘、共性问题或方向取证。只输出合法 JSON。",
      messages: [
        {
          role: "user",
          content: `用户消息：「${content}」\n如果需要调取他过往的面试记录来回答，输出 {"needRecords": true}，否则 {"needRecords": false}。`,
        },
      ],
      thinkingEnabled: false,
    });
    return raw?.needRecords === true;
  } catch (error) {
    console.error("record-analysis intent LLM check failed", error);
    return false;
  }
}

/**
 * 按需检索面试记录（上下文有界）：
 * - 若会话已置顶焦点记录（pinned），优先使用并截断到 limit。
 * - 否则取最近 limit 场「已完成」的一对一 + 群面记录（群面经适配器转为统一格式）。
 */
export async function fetchConsultRecordsOnDemand(opts: {
  ownerId: string;
  pinned?: InterviewHistoryRecord[];
  limit?: number;
}): Promise<InterviewHistoryRecord[]> {
  const limit = opts.limit ?? DEFAULT_RECORD_LIMIT;
  if (opts.pinned?.length) return opts.pinned.slice(0, PINNED_RECORD_LIMIT);

  // 数据库侧已 limit，避免拉取用户的全部历史；群面多取一些以抵消「未出报告」过滤。
  const [oneOnOne, groupList] = await Promise.all([
    listInterviewRecords(opts.ownerId, limit),
    listGroupSessions(opts.ownerId, limit * 2),
  ]);

  const groupWithReport = groupList.filter((g) => g.hasReport).slice(0, limit);
  const groupSessions = await Promise.all(
    groupWithReport.map((g) => getGroupSession(g.id, opts.ownerId))
  );
  const groupRecords = groupSessions
    .map((session) => (session ? groupSessionToConsultRecord(session) : null))
    .filter((record): record is NonNullable<typeof record> => record !== null)
    .sort((a, b) => b.reportedAt - a.reportedAt);

  // 给群面保留一个配额，避免被一对一记录按时间挤掉；最终再按时间排序取前 limit。
  const groupQuota = Math.min(groupRecords.length, Math.floor(limit / 4));
  return [...oneOnOne.slice(0, limit - groupQuota), ...groupRecords.slice(0, groupQuota)]
    .sort((a, b) => b.reportedAt - a.reportedAt)
    .slice(0, limit);
}
