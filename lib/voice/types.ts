export type AsrMethod = "browser" | "whisper" | "doubao";
export type TtsMethod = "browser" | "openai" | "doubao" | "off";

export type VoiceSettings = {
  asr: AsrMethod;
  tts: TtsMethod;
  voice: string; // OpenAI voice name or browser voice URI
  autoPlay: boolean;
  speedRatio?: number;
};

export const RANDOM_DOUBAO_VOICE = "__random_doubao_voice__";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  asr: "doubao",
  tts: "doubao",
  voice: "zh_female_shuangkuaisisi_moon_bigtts",
  autoPlay: true,
};

export const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

// 每个音色绑定自己的 resource ID；选中音色后由后端自动用对应模型版本
export type DoubaoVoice = {
  id: string;
  label: string;
  resourceId: "seed-tts-1.0" | "seed-tts-2.0";
  group?: string;
  locale?: "zh" | "en" | "multi";
  tags?: string[];
};

export const DOUBAO_VOICES: DoubaoVoice[] = [
  // ========== 中文女声 ==========
  { id: "zh_female_shuangkuaisisi_moon_bigtts", label: "爽快思思", resourceId: "seed-tts-1.0", group: "女声", locale: "multi", tags: ["中文", "英文"] },
  { id: "zh_female_shuangkuaisisi_emo_v2_mars_bigtts", label: "爽快思思 · 多情感", resourceId: "seed-tts-1.0", group: "女声", locale: "multi", tags: ["中文", "英文", "多情感"] },
  { id: "zh_female_gaolengyujie_moon_bigtts", label: "高冷御姐", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文"] },
  { id: "zh_female_gaolengyujie_emo_v2_mars_bigtts", label: "高冷御姐 · 多情感", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文", "多情感"] },
  { id: "zh_female_wanwanxiaohe_moon_bigtts", label: "湾湾小何", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文"] },
  { id: "zh_female_sajiaonvyou_moon_bigtts", label: "撒娇女友", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文"] },
  { id: "zh_female_linjianvhai_moon_bigtts", label: "邻家女孩", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文"] },
  { id: "zh_female_daimengchuanmei_moon_bigtts", label: "呆萌川妹", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文"] },
  { id: "zh_female_yuanqinvyou_moon_bigtts", label: "元气女友", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文"] },
  { id: "zh_female_kailangjiejie_moon_bigtts", label: "开朗姐姐", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文"] },
  { id: "zh_female_cancan_mars_bigtts", label: "灿灿", resourceId: "seed-tts-1.0", group: "女声", locale: "multi", tags: ["中文", "英文"] },
  { id: "zh_female_jitangmeimei_mars_bigtts", label: "鸡汤妹妹", resourceId: "seed-tts-1.0", group: "女声", locale: "multi", tags: ["中文", "英文"] },
  { id: "zh_female_tiexinnvsheng_mars_bigtts", label: "贴心女声", resourceId: "seed-tts-1.0", group: "女声", locale: "multi", tags: ["中文", "英文"] },
  { id: "zh_female_mengyatou_mars_bigtts", label: "萌丫头", resourceId: "seed-tts-1.0", group: "女声", locale: "multi", tags: ["中文", "英文"] },
  { id: "zh_female_popo_mars_bigtts", label: "婆婆", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文"] },
  { id: "zh_female_linjia_mars_bigtts", label: "邻家", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文"] },
  { id: "zh_female_qingxinnvsheng_mars_bigtts", label: "清新女声", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文"] },
  { id: "zh_female_zhixingjiejie_mars_bigtts", label: "知性姐姐", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文"] },

  // ========== 中文男声 ==========
  { id: "zh_male_yangguangqingnian_moon_bigtts", label: "阳光青年", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文"] },
  { id: "zh_male_yangguangqingnian_emo_v2_mars_bigtts", label: "阳光青年 · 多情感", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文", "多情感"] },
  { id: "zh_male_yangguangqingnian_mars_bigtts", label: "阳光青年 · mars", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文"] },
  { id: "zh_male_beijingxiaoye_moon_bigtts", label: "北京小爷", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文"] },
  { id: "zh_male_beijingxiaoye_emo_v2_mars_bigtts", label: "北京小爷 · 多情感", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文", "多情感"] },
  { id: "zh_male_wennuanahu_moon_bigtts", label: "温暖阿虎", resourceId: "seed-tts-1.0", group: "男声", locale: "multi", tags: ["中文", "英文"] },
  { id: "zh_male_shaonianzixin_moon_bigtts", label: "少年梓辛", resourceId: "seed-tts-1.0", group: "男声", locale: "multi", tags: ["中文", "英文"] },
  { id: "zh_male_jieshuonansheng_mars_bigtts", label: "解说男声", resourceId: "seed-tts-1.0", group: "男声", locale: "multi", tags: ["中文", "英文"] },
  { id: "zh_male_guozhoudege_moon_bigtts", label: "广州德哥", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文"] },
  { id: "zh_male_silang_mars_bigtts", label: "司朗", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文"] },
  { id: "zh_male_baqiqingshu_mars_bigtts", label: "霸气青叔", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文"] },
  { id: "zh_male_naiqimengwa_mars_bigtts", label: "奶气萌娃", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文"] },
  { id: "zh_male_xionger_mars_bigtts", label: "熊二", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文"] },
  { id: "zh_male_chunhui_mars_bigtts", label: "淳辉", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文"] },

  // ========== 智能群面专用音色（每场随机抽取、性别匹配；不在 UI 暴露选择） ==========
  // 这些音色均属于豆包 TTS 1.0（seed-tts-1.0）范畴，speaker id 直接透传给豆包。
  { id: "ICL_zh_male_shuanglangxiaoyang_cs_tob", label: "爽朗小阳", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文", "群面"] },
  { id: "en_male_jason_conversation_wvae_bigtts", label: "Jason", resourceId: "seed-tts-1.0", group: "男声", locale: "multi", tags: ["中文", "英文", "群面"] },
  { id: "ICL_zh_male_qinqiexiaozhuo_cs_tob", label: "亲切小卓", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文", "群面"] },
  { id: "zh_male_xudong_conversation_wvae_bigtts", label: "旭东", resourceId: "seed-tts-1.0", group: "男声", locale: "zh", tags: ["中文", "群面"] },
  { id: "zh_female_qinqienvsheng_moon_bigtts", label: "亲切女声", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文", "群面"] },
  { id: "ICL_zh_female_qingyingduoduo_cs_tob", label: "轻盈朵朵", resourceId: "seed-tts-1.0", group: "女声", locale: "zh", tags: ["中文", "群面"] },
];

// 智能群面 TTS 音色池：每场随机抽取、按性别匹配头像。详见 lib/groupInterview。
export const GROUP_INTERVIEW_VOICE_POOL: { id: string; gender: "male" | "female" }[] = [
  { id: "ICL_zh_male_shuanglangxiaoyang_cs_tob", gender: "male" },
  { id: "en_male_jason_conversation_wvae_bigtts", gender: "male" },
  { id: "ICL_zh_male_qinqiexiaozhuo_cs_tob", gender: "male" },
  { id: "zh_male_xudong_conversation_wvae_bigtts", gender: "male" },
  { id: "zh_female_qinqienvsheng_moon_bigtts", gender: "female" },
  { id: "zh_female_linjianvhai_moon_bigtts", gender: "female" },
  { id: "ICL_zh_female_qingyingduoduo_cs_tob", gender: "female" },
];

// 群面 HR / 主持人音色（与一对一面试一致：爽快思思）。
export const GROUP_INTERVIEW_HOST_VOICE = "zh_female_shuangkuaisisi_moon_bigtts";

export function findDoubaoVoice(id: string): DoubaoVoice | undefined {
  return DOUBAO_VOICES.find((v) => v.id === id);
}

export function isRandomDoubaoVoice(id?: string | null): boolean {
  return id === RANDOM_DOUBAO_VOICE;
}

export function pickRandomDoubaoVoice(language?: "zh" | "en"): DoubaoVoice {
  const pool = DOUBAO_VOICES.filter((voice) => {
    if (language === "en") return ["en", "multi"].includes(voice.locale ?? "zh");
    return ["zh", "multi"].includes(voice.locale ?? "zh");
  });
  const candidates = pool.length > 0 ? pool : DOUBAO_VOICES;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
