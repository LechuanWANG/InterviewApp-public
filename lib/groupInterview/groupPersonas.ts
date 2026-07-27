import type { Language } from "@/lib/types";
import { GROUP_INTERVIEW_VOICE_POOL } from "@/lib/voice/types";
import {
  type GroupMember,
  type GroupPersonaId,
  type Gender,
  GROUP_AI_STUDENT_COUNT,
} from "./types";

// ============================================================
// 智能群面：讨论人格库 + 学生选角(casting)
// ============================================================

export type GroupPersonaDef = {
  id: GroupPersonaId;
  label: string;
  // 注入到学生发言 prompt 的风格描述
  styleHint: string;
  // 发言倾向权重(越高越爱抢话/频繁发言)，用于 director 偏置
  speakWeight: number;
};

export const GROUP_PERSONAS: GroupPersonaDef[] = [
  {
    id: "leader",
    label: "领跑者",
    speakWeight: 1.3,
    styleHint:
      "你是组里的领跑者：习惯第一个发言、主动给讨论搭框架、推进节奏。说话有条理、爱用「我建议我们先…再…」「我们可以分成几块来看」这类结构性语言，但不独断，会邀请别人补充。",
  },
  {
    id: "synthesizer",
    label: "总结者",
    speakWeight: 1.0,
    styleHint:
      "你是组里的总结者：擅长归纳别人的观点、找共识、把发散的讨论收拢。发言时几乎总是先概括前面几位的核心观点，再点出共识与分歧，常用「综合刚才几位的意见」「大家其实都在说…」。",
  },
  {
    id: "analyst",
    label: "数据派",
    speakWeight: 1.0,
    styleHint:
      "你是组里的数据派：重数据、重可行性、重落地。习惯追问「这个方案的成本/收益是多少」「有没有数据支撑」，对空泛口号会礼貌质疑，常把观点转化为可量化的判断标准。",
  },
  {
    id: "challenger",
    label: "激进派",
    speakWeight: 1.4,
    styleHint:
      "你是组里的激进派：观点鲜明、爱抢话、敢提反对意见。会直接说「我不太同意刚才的说法」并给出理由，制造适度的张力和讨论压力，但对事不对人，不进行人身攻击。",
  },
  {
    id: "supporter",
    label: "稳健派",
    speakWeight: 0.8,
    styleHint:
      "你是组里的稳健派：温和、善于补充细节、附议中带小修正。常说「我同意，同时补充一点」，负责缓冲冲突、补全被忽略的角度，让讨论更完整。",
  },
  {
    id: "quiet",
    label: "边缘者",
    speakWeight: 0.5,
    styleHint:
      "你是组里偏内向的成员：发言不多，通常被点到或被邀请时才说，但一旦发言往往简短而有价值。不会主动抢话。",
  },
];

export function findGroupPersona(id?: GroupPersonaId | null): GroupPersonaDef {
  return GROUP_PERSONAS.find((p) => p.id === id) ?? GROUP_PERSONAS[1];
}

// 选角必含人格：保证讨论有总结者和激进派的张力
const REQUIRED_PERSONAS: GroupPersonaId[] = ["synthesizer", "challenger"];

const NAME_POOL: Record<Language, { male: string[]; female: string[] }> = {
  zh: {
    male: ["林同学", "王同学", "张同学", "陈同学", "赵同学", "周同学"],
    female: ["李同学", "刘同学", "杨同学", "黄同学", "吴同学", "孙同学"],
  },
  en: {
    male: ["Alex", "Ryan", "Daniel", "Kevin", "Marcus", "Ethan"],
    female: ["Emma", "Sophia", "Grace", "Chloe", "Olivia", "Hannah"],
  },
};

const BACKGROUND_POOL: Record<Language, string[]> = {
  zh: [
    "理工科背景，喜欢从可行性和数据入手",
    "商科背景，偏好从商业价值和用户角度切入",
    "有大厂实习经历，注重落地和执行细节",
    "学生组织负责人出身，擅长统筹和协调",
    "跨专业转方向，视角发散、爱提新点子",
    "做过竞赛/课题，逻辑严谨、追求结构化",
  ],
  en: [
    "STEM background, leans on feasibility and data",
    "Business background, frames things around value and users",
    "Has top-company internship experience, focuses on execution",
    "Former student-org lead, good at coordination",
    "Cross-disciplinary switcher, divergent and idea-rich",
    "Competition/research background, rigorous and structured",
  ],
};

// 头像池(已就位)：每个性别 3 张
const AVATAR_KEYS: Record<Gender, string[]> = {
  male: ["student_male_1", "student_male_2", "student_male_3"],
  female: ["student_female_1", "student_female_2", "student_female_3"],
};

function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickGenderSplit(count: number): Gender[] {
  // 每个性别头像/音色最多 3 个，所以 4 名学生的性别分布限制在 1..3
  const maxPerGender = 3;
  const maleCount = Math.min(
    maxPerGender,
    Math.max(count - maxPerGender, 1 + Math.floor(Math.random() * (count - 1)))
  );
  const femaleCount = count - maleCount;
  const genders: Gender[] = [
    ...Array(maleCount).fill("male"),
    ...Array(femaleCount).fill("female"),
  ];
  return shuffle(genders);
}

function pickPersonas(count: number): GroupPersonaId[] {
  const rest = shuffle(
    GROUP_PERSONAS.map((p) => p.id).filter((id) => !REQUIRED_PERSONAS.includes(id))
  );
  const chosen = [...REQUIRED_PERSONAS, ...rest].slice(0, count);
  return shuffle(chosen);
}

export type GroupUserCastingOptions = {
  userName?: string;
  userBackground?: string;
};

/**
 * 选角：返回用户 + 学生1..4。每场随机抽取人格、性别、头像、音色、姓名、背景；
 * 头像与音色按性别匹配且组内不重复，用户座次随机插入。
 */
export function castGroupMembers(
  language: Language,
  options: GroupUserCastingOptions = {}
): GroupMember[] {
  const studentCount = GROUP_AI_STUDENT_COUNT;
  const genders = pickGenderSplit(studentCount);
  const personas = pickPersonas(studentCount);

  const avatarsByGender: Record<Gender, string[]> = {
    male: shuffle(AVATAR_KEYS.male),
    female: shuffle(AVATAR_KEYS.female),
  };
  const voicesByGender: Record<Gender, string[]> = {
    male: shuffle(GROUP_INTERVIEW_VOICE_POOL.filter((v) => v.gender === "male").map((v) => v.id)),
    female: shuffle(GROUP_INTERVIEW_VOICE_POOL.filter((v) => v.gender === "female").map((v) => v.id)),
  };
  const namesByGender: Record<Gender, string[]> = {
    male: shuffle(NAME_POOL[language].male),
    female: shuffle(NAME_POOL[language].female),
  };
  const backgrounds = shuffle(BACKGROUND_POOL[language]);

  // 按性别各自计数取头像/音色/姓名，避免用全局序号去索引「分性别」数组：
  // 否则同性别的第二个人会越界回退到固定的第 0 张头像，和已分配的洗牌头像撞车(出现重复照片)。
  const genderCursor: Record<Gender, number> = { male: 0, female: 0 };
  const students: GroupMember[] = genders.map((gender, index) => {
    const gi = genderCursor[gender];
    genderCursor[gender] += 1;
    return {
      id: `student_${index + 1}`,
      kind: "student" as const,
      name: namesByGender[gender][gi] ?? (language === "zh" ? `同学${index + 1}` : `Peer ${index + 1}`),
      gender,
      avatarKey: avatarsByGender[gender][gi] ?? AVATAR_KEYS[gender][gi % AVATAR_KEYS[gender].length],
      voice: voicesByGender[gender][gi] ?? voicesByGender[gender][gi % voicesByGender[gender].length],
      persona: personas[index],
      background: backgrounds[index],
    };
  });

  const user: GroupMember = {
    id: "user",
    kind: "user",
    name: options.userName?.trim() || (language === "zh" ? "你" : "You"),
    gender: "female", // 用户性别不影响展示(固定用 user-speaking 图)
    avatarKey: "user-speaking",
    voice: "",
    background: options.userBackground?.trim() || undefined,
  };

  // 用户座次全随机：可能第 1 位，也可能在任意其他位置。
  const insertAt = Math.floor(Math.random() * (students.length + 1));
  const ordered = [...students];
  ordered.splice(insertAt, 0, user);
  return ordered;
}

// 参与轮流发言的成员(用户 + 学生)，host/leader 不在其中。
export function turnTakingMembers(members: GroupMember[]): GroupMember[] {
  return members.filter((m) => m.kind === "user" || m.kind === "student");
}
