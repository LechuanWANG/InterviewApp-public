import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReportView from "@/components/ReportView";
import ReportFloatingNav from "@/components/ReportFloatingNav";
import { getSession } from "@/lib/store";
import { UiText } from "@/components/LanguageProvider";
import { ensureSessionReport } from "@/lib/interview/reportService";
import { getCurrentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ReportPage({
  params,
}: {
  params: { sessionId: string };
}) {
  const { sessionId } = params;
  const ownerId = getCurrentUserId();
  if (!ownerId) redirect(`/login?next=/report/${sessionId}`);
  const session = await getSession(sessionId, ownerId);
  if (!session) notFound();
  let reportSession = session;
  if (!reportSession.report && reportSession.rounds.length > 0) {
    reportSession = await ensureSessionReport(reportSession);
  }

  if (!reportSession.report) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-4 flex justify-end">
          <Link href="/?expanded=1" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
            <UiText id="report.backHome" />
          </Link>
        </div>
        <div className="text-sm text-slate-600"><UiText id="reportPage.notReady" /></div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <ReportFloatingNav
        consultHref={`/summary?preselect=${sessionId}`}
        confirmHref="/?expanded=1"
        company={reportSession.company}
        jobTitle={reportSession.jobTitle}
        mbtiMode={reportSession.report.reportKind === "mbti"}
        showAnswers={(reportSession.report.betterAnswers?.length ?? 0) > 0}
      />
      <ReportView
        report={reportSession.report}
        rounds={reportSession.rounds}
        company={reportSession.company}
        jobTitle={reportSession.jobTitle}
        sessionId={reportSession.id}
        className="mx-auto max-w-3xl"
      />
    </main>
  );
}
