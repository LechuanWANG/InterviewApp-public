import { notFound, redirect } from "next/navigation";
import ReportView from "@/components/ReportView";
import ReportFloatingNav from "@/components/ReportFloatingNav";
import { getInterviewRecordById } from "@/lib/historyStore";
import { getCurrentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function InterviewHistoryDetailPage({
  params,
}: {
  params: { recordId: string };
}) {
  const ownerId = getCurrentUserId();
  if (!ownerId) redirect("/login?next=/history");
  const record = await getInterviewRecordById(params.recordId, ownerId);
  if (!record) notFound();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <ReportFloatingNav
        consultHref={`/summary?preselect=${record.id}`}
        confirmHref="/history"
        company={record.company}
        jobTitle={record.jobTitle}
        mbtiMode={record.report.reportKind === "mbti"}
        showAnswers={(record.report.betterAnswers?.length ?? 0) > 0}
      />
      <ReportView
        report={record.report}
        rounds={record.rounds}
        company={record.company}
        jobTitle={record.jobTitle}
        sessionId={record.sessionId}
        className="mx-auto max-w-3xl"
      />
    </main>
  );
}
