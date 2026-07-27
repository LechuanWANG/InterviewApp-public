import InterviewFormatChoice from "@/components/InterviewFormatChoice";
import { getCurrentUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function InterviewChoosePage() {
  if (!getCurrentUserId()) redirect("/login?next=/interview/choose");

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <InterviewFormatChoice />
    </main>
  );
}
