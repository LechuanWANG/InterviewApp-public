"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateInterviewPlan = generateInterviewPlan;
const llm_1 = require("../llm");
const personas_1 = require("../personas");
const TYPE_DESC = {
    hr: "HR/非技术综合面试，侧重软素质、职业动机、稳定性",
    technical: "技术面试，侧重硬技能、项目深度、系统设计",
    behavioral: "行为面试，侧重 STAR 结构、团队协作、冲突处理",
    mixed: "综合面试，混合 HR + 技术 + 行为",
};
const TYPE_GUARDRAILS = {
    hr: "本场是 HR 面。只能围绕职业动机、稳定性、价值观、团队协作、薪资期望、入职意愿、文化匹配等 HR 主题提问。不要追问算法、系统设计、框架原理、数据库细节等技术问题。",
    technical: "本场是技术面。问题应围绕技术基础、项目技术细节、工程实践、系统设计、问题定位、性能优化等主题，可以适度追问协作，但不要变成纯 HR 面。",
    behavioral: "本场是行为面。问题必须围绕真实经历、团队协作、冲突处理、压力情境、失败复盘、沟通方式、决策偏好等行为事件展开。不要追问技术实现细节；需要通过回答观察候选人的行为倾向和人格表达。",
    mixed: "本场是综合面。可以混合 HR、技术、行为问题，但每一轮问题都要贴合简历与 JD，不要无关跳题。",
};
async function generateInterviewPlan(params) {
    const { resume, company, jobTitle, jd, interviewType, language, persona, difficulty, llm, } = params;
    const lang = language === "zh" ? "中文" : "English";
    const p = (0, personas_1.findPersona)(persona);
    const d = (0, personas_1.findDifficulty)(difficulty);
    const system = `${p.styleHint}

${d.hint}

${TYPE_GUARDRAILS[interviewType]}

请以 ${lang} 输出所有问题与开场白。`;
    const userContent = `请基于以下信息设计一场面试：

【目标公司】${company}
【目标岗位】${jobTitle}
【面试类型】${TYPE_DESC[interviewType]}
【JD】
${jd}

【候选人简历】
${resume}

请输出 JSON，字段如下：
{
  "focusAreas": ["本场面试要考察的 3~5 个重点维度（结合简历和 JD 的匹配点/差距点）"],
  "plannedQuestions": ["按顺序提问的候选问题，贴合简历与 JD，数量参考当前难度"],
  "openingQuestion": "面试开场的第一句话或第一个问题，应符合你的面试官人格风格"
}`;
    return (0, llm_1.getLLM)(llm).completeJSON({
        system,
        messages: [{ role: "user", content: userContent }],
        thinkingEnabled: llm?.thinkingEnabled,
    });
}
