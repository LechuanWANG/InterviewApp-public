// 面试形式：进入面试板块后先选择，再填写简历/JD，最后进入对应配置。
// 通过 sessionStorage 在「选择 → 表单 → 配置」三步之间传递。
export type InterviewFormat = "one_on_one" | "group";

export const INTERVIEW_FORMAT_KEY = "interview-format";

export function readInterviewFormat(): InterviewFormat {
  try {
    return sessionStorage.getItem(INTERVIEW_FORMAT_KEY) === "group" ? "group" : "one_on_one";
  } catch {
    return "one_on_one";
  }
}
