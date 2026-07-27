import ConsultChat from "@/components/ConsultChat";
import { getCurrentUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function ConsultPage({
  params,
}: {
  params: { consultId: string };
}) {
  if (!getCurrentUserId()) redirect(`/login?next=/consult/${params.consultId}`);

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      <ConsultChat consultId={params.consultId} />
    </main>
  );
}
