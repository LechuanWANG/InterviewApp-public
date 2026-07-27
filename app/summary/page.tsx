import SummarySelection from "@/components/SummarySelection";
import { getCurrentUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function SummaryPage({
  searchParams,
}: {
  searchParams?: { preselect?: string };
}) {
  if (!getCurrentUserId()) {
    const next = searchParams?.preselect
      ? `/summary?preselect=${encodeURIComponent(searchParams.preselect)}`
      : "/summary";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  return (
    <main className="max-w-4xl mx-auto px-6 py-10">
      <SummarySelection preselect={searchParams?.preselect} />
    </main>
  );
}
