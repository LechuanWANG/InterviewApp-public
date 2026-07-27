import { redirect, notFound } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth";
import { getGroupSession } from "@/lib/groupInterview/store";
import GroupInterviewRoom from "@/components/GroupInterviewRoom";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GroupRoomPage({ params }: { params: { id: string } }) {
  const ownerId = getCurrentUserId();
  if (!ownerId) redirect(`/login?next=/group/${params.id}`);

  const session = await getGroupSession(params.id, ownerId);
  if (!session) notFound();

  if (session.status === "finished" && session.report) {
    redirect(`/group/${params.id}/report`);
  }

  return (
    <GroupInterviewRoom
      init={{
        id: session.id,
        language: session.language,
        durations: session.durations,
        topic: session.topic,
        members: session.members,
        transcript: session.transcript,
        voice: session.voice,
        phase: session.phase,
        reporterId: session.reporterId,
        reporterKind: session.reporterKind,
      }}
    />
  );
}
