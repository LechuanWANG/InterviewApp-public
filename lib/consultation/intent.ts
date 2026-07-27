export type ConsultDialogueIntent =
  | "direct_question"
  | "decision_help"
  | "plan_request"
  | "review_request"
  | "emotion_or_confusion"
  | "diagnostic_request"
  | "open_followup";

export type ConsultTurnIntent =
  | "direction_judgement"
  | "single_review"
  | "common_issues"
  | "practice_plan"
  | "evidence_explain"
  | "free_question";

export function inferConsultDialogueIntent(text: string): ConsultDialogueIntent {
  const normalized = text.trim();
  if (!normalized) return "open_followup";

  if (/(选|选择|哪个|哪一个|更适合|要不要|该不该|还要|继续投|还投|不投|放弃|还是|比较|offer|vs|versus)/i.test(normalized)) {
    return "decision_help";
  }

  if (/(计划|规划|安排|下一步|接下来|七天|7天|怎么练|如何练|准备|训练|practice plan|next step)/i.test(normalized)) {
    return "plan_request";
  }

  if (/(复盘|评价|看看|分析这段|这段回答|回答得|帮我改|润色|简历|面试表现|review|revise|polish)/i.test(normalized)) {
    return "review_request";
  }

  if (/(焦虑|迷茫|纠结|害怕|担心|恐惧|崩|累|没信心|不想|confused|anxious|worried|lost)/i.test(normalized)) {
    return "emotion_or_confusion";
  }

  if (/(共性|短板|问题在哪|哪里不行|诊断|反复|老是|总是|common issue|diagnose|weakness)/i.test(normalized)) {
    return "diagnostic_request";
  }

  if (/[？?]|(怎么|如何|为什么|是否|是不是|能否|可以吗|怎么办|what|why|how|should|can|could)/i.test(normalized)) {
    return "direct_question";
  }

  return "open_followup";
}

/**
 * 关键词快路径：用户这句话是否明显在请求「基于过往面试记录」的复盘/共性/取证。
 * 命中即触发按需检索；更模糊的表述由 recordFetch 里的轻量 LLM 兜底判断。
 */
export function detectRecordAnalysisIntent(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return /(复盘|共性|逐场|那几场|这几场|几场面试|多场面试|上一场|上次面试|上次的面试|之前的面试|历史面试|我的面试|面试记录|面试表现|哪几场|哪一场|面试.*分数|分数.*面试|review my|common issue|past interview)/i.test(
    normalized
  );
}

export function inferConsultTurnIntent(text: string): ConsultTurnIntent {
  const normalized = text.trim();
  if (!normalized) return "free_question";

  if (/(为什么|依据|凭什么|证据|来源|哪里看出|你怎么判断|reason|evidence|why)/i.test(normalized)) {
    return "evidence_explain";
  }

  if (/(选|选择|哪个|哪一个|更适合|要不要|该不该|继续投|还投|不投|放弃|方向|岗位|主攻|转行|转岗|offer|vs|versus)/i.test(normalized)) {
    return "direction_judgement";
  }

  if (/(计划|规划|安排|下一步|接下来|七天|7天|怎么练|如何练|准备|训练|practice plan|next step)/i.test(normalized)) {
    return "practice_plan";
  }

  if (/(复盘|评价|看看|分析这段|这段回答|回答得|帮我改|润色|简历|面试表现|review|revise|polish)/i.test(normalized)) {
    return "single_review";
  }

  if (/(共性|短板|问题在哪|哪里不行|诊断|反复|老是|总是|common issue|diagnose|weakness)/i.test(normalized)) {
    return "common_issues";
  }

  return "free_question";
}

export function consultDialogueIntentLabel(intent: ConsultDialogueIntent): string {
  if (intent === "direct_question") return "用户在问一个具体问题";
  if (intent === "decision_help") return "用户需要选择判断";
  if (intent === "plan_request") return "用户需要行动计划";
  if (intent === "review_request") return "用户需要复盘或修改具体材料";
  if (intent === "emotion_or_confusion") return "用户处在焦虑或迷茫状态";
  if (intent === "diagnostic_request") return "用户主动要求诊断共性问题";
  return "用户还没有提出明确问题";
}

export function consultDialogueIntentInstruction(intent: ConsultDialogueIntent): string {
  if (intent === "direct_question") {
    return "先直接回答用户这个问题，再补充必要依据；不要主动切到历史共性问题。结尾最多给 1 个可选追问。";
  }
  if (intent === "decision_help") {
    return "先给出明确倾向，再说明判断标准、主要风险与一个下一步动作；不要两边均衡、回避判断。";
  }
  if (intent === "plan_request") {
    return "给 1-3 个可执行动作，按优先级排序；不要展开成长篇方向诊断。";
  }
  if (intent === "review_request") {
    return "聚焦用户要求复盘或修改的具体内容，指出最关键问题并给改法；不要强行转到职业方向判断。";
  }
  if (intent === "emotion_or_confusion") {
    return "先承接情绪，再把问题收束为一个可执行选择或动作；表达克制，不说教、不施压。";
  }
  if (intent === "diagnostic_request") {
    return "可以主动综合历史短板，但只挑最重要的 1-2 个问题；避免把所有旧问题都翻出来。";
  }
  return "如果用户没有明确问题，可以自然地抛出一两个能聊的方向把话头递回去；不要长篇主导，也不必每次都列固定的选项清单。";
}
