import HistoryRecordsPage from "@/components/HistoryRecordsPage";
import { getCurrentUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function InterviewHistoryPage() {
  if (!getCurrentUserId()) redirect("/login?next=/history");

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <HistoryRecordsPage />
    </main>
  );
}
