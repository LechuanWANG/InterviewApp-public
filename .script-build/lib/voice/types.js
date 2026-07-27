"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOUBAO_VOICES = exports.OPENAI_VOICES = exports.DEFAULT_VOICE_SETTINGS = exports.RANDOM_DOUBAO_VOICE = void 0;
exports.findDoubaoVoice = findDoubaoVoice;
exports.isRandomDoubaoVoice = isRandomDoubaoVoice;
exports.pickRandomDoubaoVoice = pickRandomDoubaoVoice;
exports.RANDOM_DOUBAO_VOICE = "__random_doubao_voice__";
exports.DEFAULT_VOICE_SETTINGS = {
    asr: "doubao",
    tts: "doubao",
    voice: "zh_female_shuangkuaisisi_moon_bigtts",
    autoPlay: true,
};
exports.OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
exports.DOUBAO_VOICES = [
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
];
function findDoubaoVoice(id) {
    return exports.DOUBAO_VOICES.find((v) => v.id === id);
}
function isRandomDoubaoVoice(id) {
    return id === exports.RANDOM_DOUBAO_VOICE;
}
function pickRandomDoubaoVoice(language) {
    const pool = exports.DOUBAO_VOICES.filter((voice) => {
        if (language === "en")
            return ["en", "multi"].includes(voice.locale ?? "zh");
        return ["zh", "multi"].includes(voice.locale ?? "zh");
    });
    const candidates = pool.length > 0 ? pool : exports.DOUBAO_VOICES;
    return candidates[Math.floor(Math.random() * candidates.length)];
}
