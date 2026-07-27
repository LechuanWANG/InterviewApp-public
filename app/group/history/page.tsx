import GroupHistoryPage from "@/components/GroupHistoryPage";
import BackButton from "@/components/BackButton";
import { getCurrentUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function GroupHistoryRoute() {
  if (!getCurrentUserId()) redirect("/login?next=/group/history");

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-4">
        <BackButton fallbackHref="/" />
      </div>
      <GroupHistoryPage />
    </main>
  );
}
