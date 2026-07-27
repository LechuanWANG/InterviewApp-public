import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getLLM } from "../lib/llm";
import type { InterviewHistoryRecord } from "../lib/historyStore";
import { annotateAnswers } from "../lib/prompts/annotateAnswers";
import { generateReport } from "../lib/prompts/finalReport";
import type { Difficulty, InterviewType, Persona, Round, Session } from "../lib/types";

loadEnvLocal();

type DemoScenario = {
  id: string;
  scenario: string;
  interviewType: InterviewType;
  persona: Persona;
  difficulty: Difficulty;
  mode: Session["mode"];
  targetLevel: "good" | "strong" | "weak";
  provider?: string;
  model?: string;
};

type GeneratedDemoSeed = {
  resume: string;
  company: string;
  jobTitle: string;
  jd: string;
  focusAreas: string[];
  plannedQuestions: string[];
  rounds: Array<{
    question: string;
    answer: string;
    isFollowUp?: boolean;
  }>;
};

const scenarios: DemoScenario[] = [
  {
    id: "demo-history-session-001",
    scenario: "生成一位前端校招生的技术面 demo。候选人基础不错但还不够成熟，整体表现中等偏稳，项目与岗位有一定匹配度，但结果证据和说服力一般。",
    interviewType: "technical",
    persona: "pro_expert",
    difficulty: "medium",
    mode: "practice",
    targetLevel: "good",
  },
  {
    id: "demo-history-session-002",
    scenario: "生成一位后端校招生的技术面 demo。候选人工程意识较强，回答扎实，结构好，整体表现明显强于平均水平。",
    interviewType: "technical",
    persona: "pro_expert",
    difficulty: "medium",
    mode: "simulate",
    targetLevel: "strong",
  },
  {
    id: "demo-history-session-003",
    scenario: "生成一位应届生的综合面 / 产品运营培训生 demo。候选人表达不算卡顿，但回答偏泛、岗位动机较弱、项目贡献不清晰，形成较明显的失败示例。",
    interviewType: "mixed",
    persona: "warm_hr",
    difficulty: "medium",
    mode: "practice",
    targetLevel: "weak",
  },
];

async function main() {
  const records: InterviewHistoryRecord[] = [];
  for (const scenario of scenarios) {
    const generated = await generateSeed(scenario);
    const session = buildSessionFromSeed(scenario, generated);
    const report = await generateReport(session);
    const annotations = await annotateAnswers(session, report);
    report.roundReviews = annotations.roundReviews;
    report.answerAnnotations = annotations.answerAnnotations;
    report.annotationSummaries = annotations.annotationSummaries;

    records.push({
      id: session.id,
      ownerId: session.ownerId,
      sessionId: session.id,
      resume: session.resume,
      company: session.company,
      jobTitle: session.jobTitle,
      jd: session.jd,
      interviewType: session.interviewType,
      language: session.language,
      persona: session.persona,
      difficulty: session.difficulty,
      mode: session.mode,
      rounds: session.rounds,
      report,
      createdAt: session.createdAt,
      reportedAt: Date.now(),
    });

    console.log(
      `Generated ${scenario.id}: ${session.jobTitle} @ ${session.company} (${report.overallBand}/9)`
    );
  }

  upsertHistoryRecords(records);
}

async function generateSeed(scenario: DemoScenario): Promise<GeneratedDemoSeed> {
  const provider = scenario.provider || process.env.DEMO_LLM_PROVIDER || process.env.LLM_PROVIDER || "deepseek";
  const model = scenario.model || process.env.DEMO_LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat";

  return getLLM({ provider, model }).completeJSON<GeneratedDemoSeed>({
    system: `你是一名“模拟求职场景生成器”。

你的任务不是写报告，而是生成一份逼真的面试 demo 原始素材，供后续系统打分。

要求：
- 生成 1 份真实感较强的简历摘要、1 个目标公司、1 个目标岗位、1 份 JD 摘要。
- 生成 3 轮面试问答，问题和回答都要贴合候选人背景、岗位和面试类型。
- 回答风格必须像真人口语作答，不要写成标准答案，不要太完美。
- 如果 targetLevel 是 weak，就让回答有明显问题，但也要像真人会说出来的话。
- 如果 targetLevel 是 strong，就让回答很扎实，但仍保留自然口语感。
- rounds 中至少包含 1 轮追问（isFollowUp=true）。
- 只输出合法 JSON。`,
    messages: [
      {
        role: "user",
        content: `请生成一个面试 demo 原始素材，要求如下：

【场景要求】
${scenario.scenario}

【面试类型】
${scenario.interviewType}

【面试官人格】
${scenario.persona}

【目标表现档位】
${scenario.targetLevel}

请输出 JSON：
{
  "resume": "候选人的简历摘要，3~6 段，真实、具体、像应届生简历",
  "company": "目标公司名",
  "jobTitle": "目标岗位名",
  "jd": "职位描述摘要，真实、贴合岗位",
  "focusAreas": ["本场面试重点，3~5 条"],
  "plannedQuestions": ["按顺序的 3 个问题"],
  "rounds": [
    {
      "question": "面试问题",
      "answer": "候选人口语化回答，长度充实",
      "isFollowUp": false
    }
  ]
}`,
      },
    ],
  });
}

function buildSessionFromSeed(scenario: DemoScenario, seed: GeneratedDemoSeed): Session {
  const now = Date.now();
  const rounds: Round[] = (seed.rounds || []).slice(0, 3).map((item) => ({
    question: item.question,
    answer: item.answer,
    isFollowUp: !!item.isFollowUp,
  }));

  return {
    id: scenario.id,
    ownerId: process.env.DEMO_OWNER_ID || "demo-user",
    resume: seed.resume,
    company: seed.company,
    jobTitle: seed.jobTitle,
    jd: seed.jd,
    interviewType: scenario.interviewType,
    language: "zh",
    persona: scenario.persona,
    difficulty: scenario.difficulty,
    mode: scenario.mode,
    provider: scenario.provider || process.env.DEMO_LLM_PROVIDER || process.env.LLM_PROVIDER || "deepseek",
    model: scenario.model || process.env.DEMO_LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat",
    thinkingEnabled: false,
    plan: {
      focusAreas: (seed.focusAreas || []).slice(0, 5),
      plannedQuestions: (seed.plannedQuestions || rounds.map((item) => item.question)).slice(0, 3),
      openingQuestion: seed.plannedQuestions?.[0] || rounds[0]?.question || "",
    },
    rounds,
    currentQuestion: null,
    currentIsFollowUp: false,
    status: "finished",
    report: null,
    createdAt: now - 1000 * 60 * 60,
  };
}

function upsertHistoryRecords(records: InterviewHistoryRecord[]) {
  const dbPath = join(process.cwd(), "data", "interview-history.json");
  const current = readHistoryDB(dbPath);
  const recordMap = new Map(records.map((record) => [record.id, record]));
  const retained = current.records.filter((item) => !recordMap.has(item.id));
  const nextRecords = [...records, ...retained];
  writeFileSync(dbPath, JSON.stringify({ records: nextRecords }, null, 2) + "\n", "utf-8");
}

function readHistoryDB(dbPath: string): { records: InterviewHistoryRecord[] } {
  try {
    const raw = readFileSync(dbPath, "utf-8");
    const parsed = JSON.parse(raw) as { records?: InterviewHistoryRecord[] };
    return { records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
}

function loadEnvLocal() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
