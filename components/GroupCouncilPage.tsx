"use client";

import InterviewCouncilPage from "./InterviewCouncilPage";
import type { CouncilVariant } from "./council/types";

const GROUP_COUNCIL_VARIANT: CouncilVariant = {
  draftKey: "group-council-draft",
  streamEndpoint: "/api/group/session/council-stream",
  sessionRoutePrefix: "/group/",
  fastEndpoint: "/api/group/session",
  buildFastBody: (draft) => ({ ...draft }),
  roles: {
    zh: ["JD 解构官", "简历深挖官", "题目设计官", "风险质疑官", "主持人"],
    en: ["JD Analyst", "Resume Deep-Dive Expert", "Topic Designer", "Risk Challenger", "Host"],
  },
};

export default function GroupCouncilPage() {
  return <InterviewCouncilPage variant={GROUP_COUNCIL_VARIANT} />;
}
