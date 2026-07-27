import { redirect, notFound } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth";
import { getGroupSession } from "@/lib/groupInterview/store";
import GroupReportView from "@/components/GroupReportView";
import ReportFloatingNav from "@/components/ReportFloatingNav";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GroupReportPage({ params }: { params: { id: string } }) {
  const ownerId = getCurrentUserId();
  if (!ownerId) redirect(`/login?next=/group/${params.id}/report`);

  const session = await getGroupSession(params.id, ownerId);
  if (!session) notFound();
  if (!session.report) redirect(`/group/${params.id}`);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <ReportFloatingNav
        confirmHref="/?expanded=1"
        company={session.company}
        jobTitle={session.jobTitle}
        showAnswers={false}
        titleKey="groupReport.title"
        confirmLabelKey="report.backHome"
      />
      <GroupReportView
        sessionId={params.id}
        report={session.report}
        topic={session.topic}
        company={session.company}
        jobTitle={session.jobTitle}
        members={session.members}
        transcript={session.transcript}
        className="mx-auto max-w-3xl"
      />
    </main>
  );
}
