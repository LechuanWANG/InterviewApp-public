import type { Language } from "@/lib/types";

/** 安全地取出字符串输入并去除首尾空白。 */
export function safeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 把群面名牌、姓名、补充背景与简历拼成一段用户画像文本（供出题/合议参考）。 */
export function buildUserProfileText(input: {
  nameplate: string;
  name: string;
  background: string;
  resume: string;
  language: Language;
}): string {
  const zh = input.language === "zh";
  const name = input.name && input.name !== input.nameplate ? input.name : "";
  return [
    input.nameplate ? `${zh ? "群面名牌" : "Group nameplate"}：${input.nameplate}` : "",
    name ? `${zh ? "姓名/称呼" : "Name"}：${name}` : "",
    input.background ? `${zh ? "补充背景" : "Additional background"}：${input.background}` : "",
    input.resume ? `${zh ? "简历/CV" : "Resume/CV"}：${input.resume}` : "",
  ].filter(Boolean).join("\n");
}
