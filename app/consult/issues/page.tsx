import BackButton from "@/components/BackButton";
import ConsultIssuesPage from "@/components/ConsultIssuesPage";
import { getCurrentUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function StrategicConsultIssuesPage() {
  if (!getCurrentUserId()) redirect("/login?next=/consult/issues");

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <div className="mb-4">
        <BackButton />
      </div>
      <ConsultIssuesPage />
    </main>
  );
}
