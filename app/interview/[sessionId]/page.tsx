import { notFound, redirect } from "next/navigation";
import InterviewChat from "@/components/InterviewChat";
import { getSession } from "@/lib/store";
import { getAnswerTimeLimitSec, getMaxInterviewRounds } from "@/lib/personas";
import { getCurrentUserId } from "@/lib/auth";

export default async function InterviewPage({
  params,
}: {
  params: { sessionId: string };
}) {
  const { sessionId } = params;
  const ownerId = getCurrentUserId();
  if (!ownerId) redirect(`/login?next=/interview/${sessionId}`);
  const session = await getSession(sessionId, ownerId);
  if (!session) notFound();
  if (!session.currentQuestion && session.rounds.length === 0) notFound();

  const initialQuestion =
    session.currentQuestion ??
    (session.rounds[session.rounds.length - 1]?.question ?? "");

  return (
    <main className="max-w-3xl mx-auto px-6 py-8">
      <InterviewChat
        sessionId={sessionId}
        initialQuestion={initialQuestion}
        language={session.language}
        initialRound={session.rounds.length + 1}
        totalRounds={getMaxInterviewRounds(session.difficulty)}
        answerTimeSec={getAnswerTimeLimitSec(session.difficulty)}
        mode={session.mode || "simulate"}
        focusAreas={session.plan?.focusAreas ?? []}
        council={session.plan?.council}
      />
    </main>
  );
}
