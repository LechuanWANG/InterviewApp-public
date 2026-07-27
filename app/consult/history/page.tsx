import ConsultHistoryPage from "@/components/ConsultHistoryPage";
import { getCurrentUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function StrategicConsultHistoryPage() {
  if (!getCurrentUserId()) redirect("/login?next=/consult/history");

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <ConsultHistoryPage />
    </main>
  );
}
