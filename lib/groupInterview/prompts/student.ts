import { getLLM } from "@/lib/llm";
import { findGroupPersona } from "../groupPersonas";
import type { DirectorDecision, GroupInterviewSession, GroupMember, SpeechIntent } from "../types";
import {
  languageLabel,
  llmConfigOf,
  memberName,
  recentTranscriptForPrompt,
  topicForPrompt,
} from "./shared";

export type StudentSpeech = { text: string; referTo: string[] };

const INTENT_GUIDE: Record<SpeechIntent, string> = {
  statement: "这是【个人陈述】环节：每个人独立回答题目、亮明自己的初步立场和理由。严禁承接、补充、总结、评价前一位同学，也不要说「我同意/补充/承接刚才」。",
  open: "这是讨论开场：用 2-3 句给讨论搭一个框架或提出切入角度。",
  build_on: "先用一句话承接/概括被指向同学的观点，再补充你自己的【新增量】(新角度/细节/可行性)，不要复述。",
  challenge: "先用一句话概括你要回应的观点，再明确提出你的【不同意见】和理由，对事不对人。",
  summarize: "先用一两句话归纳目前几位同学的核心观点与共识，再点出仍存在的分歧或待补的点。",
  cue_quiet: "先简短表达你的观点，再自然地把话递给还没怎么发言的同学(用名字邀请)。",
  wrap_up: "讨论临近结束：用 2-3 句帮全组收口，给出一个相对收敛的结论方向或行动清单雏形。",
};

type GenerateSpeechInput = {
  session: GroupInterviewSession;
  member: GroupMember;
  decision: DirectorDecision;
};

/**
 * 学生发言：个人陈述阶段独立表达观点；自由讨论阶段再承接、补充、反驳或总结。
 */
export async function generateStudentSpeech(input: GenerateSpeechInput): Promise<StudentSpeech> {
  const { session, member, decision } = input;
  const persona = findGroupPersona(member.persona);
  const referNames = decision.referToSpeakers
    .map((id) => memberName(session, id))
    .filter(Boolean);

  const system = `你是一场校招无领导小组讨论中的一名学生：${member.name}。
${persona.styleHint}
你的背景：${member.background ?? "普通校招候选人"}。

群面发言铁律：
1. 简短：2-4 句、口语化，符合群面语速，绝不写小作文。
2. ${INTENT_GUIDE[decision.intent]}
3. 守人格：保持你的性格特征，但对事不对人，不进行人身攻击。
4. ${decision.intent === "statement"
    ? "个人陈述只回答题目本身，不引用、不承接、不总结其他同学；即使你是总结型人格，此环节也不要总结前面的人。"
    : "不重复：不复述已经说过的观点；可以附议但必须加新角度。"}
5. 守边界：紧扣题目与岗位语境，不跑题闲聊。
6. 与其他同学观点形成差异，避免全组同质化。
全程使用${languageLabel(session.language)}。严格只输出 JSON。`;

  const recentBlock = decision.intent === "statement"
    ? "【个人陈述规则】\n这是第一轮依次发表个人观点。不要承接或回应前面任何同学，只从题目出发表达你的独立判断。"
    : `【最近发言】\n${recentTranscriptForPrompt(session)}`;

  const userContent = `${topicForPrompt(session)}

${recentBlock}

【本次发言要求】
- 你的发言意图：${decision.intent}
- 需要承接/回应的同学：${decision.intent === "statement" ? "（个人陈述不承接任何人）" : referNames.length ? referNames.join("、") : "（无，可直接表达）"}
- 调度说明：${decision.reason || "正常推进讨论"}

请输出 JSON：
{
  "text": "你这次要说的话(2-4句，口语化)",
  "referTo": ["你实际承接到的同学名字或id，没有就空数组"]
}`;

  try {
    const raw = await getLLM(llmConfigOf(session)).completeJSON<StudentSpeech>({
      system,
      messages: [{ role: "user", content: userContent }],
      thinkingEnabled: session.thinkingEnabled,
    });
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (!text) return fallbackSpeech(input, referNames);
    return {
      text,
      referTo: decision.intent === "statement"
        ? []
        : Array.isArray(raw?.referTo)
        ? raw.referTo.map((v) => String(v).trim()).filter(Boolean)
        : decision.referToSpeakers,
    };
  } catch (error) {
    console.warn("student speech generation failed, using fallback", error);
    return fallbackSpeech(input, referNames);
  }
}

function fallbackSpeech(input: GenerateSpeechInput, referNames: string[]): StudentSpeech {
  const { session, decision } = input;
  const zh = session.language === "zh";
  if (decision.intent === "statement") {
    return {
      text: zh
        ? "我先说一下我的初步想法：我觉得这道题可以先明确目标和约束，再分几个方向去展开。"
        : "Let me share my initial take: I think we should first clarify the goal and constraints, then break it into a few directions.",
      referTo: [],
    };
  }
  if (decision.intent === "summarize") {
    return {
      text: zh
        ? "综合刚才几位的意见，大家其实都认同要先抓重点、控制成本，分歧主要在落地顺序上，我建议我们围绕这一点收一下。"
        : "Summarizing what's been said, we mostly agree on focusing priorities and controlling cost; the main divergence is sequencing — let's converge on that.",
      referTo: input.decision.referToSpeakers,
    };
  }
  const lead = referNames.length ? (zh ? `承接${referNames[0]}的观点，` : `Building on ${referNames[0]}, `) : "";
  return {
    text: zh
      ? `${lead}我补充一个角度：我们可以从可行性和优先级上再细化一下，这样结论会更扎实。`
      : `${lead}I'd add one angle: let's refine feasibility and priority so the conclusion is more solid.`,
    referTo: input.decision.referToSpeakers,
  };
}
